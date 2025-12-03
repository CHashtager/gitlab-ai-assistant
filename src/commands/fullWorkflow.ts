import * as vscode from 'vscode';
import { GitService } from '../services/gitService';
import { GitLabService } from '../services/gitlabService';
import { LLMService } from '../services/llmService';
import { ConfigManager, getWorkspaceFolder } from '../utils/config';
import { loadBusinessContext } from '../utils/businessContext';
import { 
  parseGitCheckRules, 
  isProtectedBranch,
  getBranchNamingInstructions,
  getCommitMessageInstructions,
  validateBranchName,
  validateCommitMessage
} from '../utils/gitCheckParser';
import * as fs from 'fs/promises';
import * as path from 'path';

export async function fullWorkflowCommand(): Promise<void> {
  const workspaceRoot = getWorkspaceFolder();
  if (!workspaceRoot) {
    vscode.window.showErrorMessage('No workspace folder open');
    return;
  }

  // Validate configuration
  if (!await ConfigManager.promptForMissingConfig()) {
    return;
  }

  const config = ConfigManager.getConfig();
  const gitService = new GitService(workspaceRoot);
  const gitlabService = new GitLabService(config);
  const llmService = new LLMService(config);

  // Check if it's a git repository
  if (!await gitService.isGitRepository()) {
    vscode.window.showErrorMessage('Current folder is not a git repository');
    return;
  }

  try {
    // Parse git-check rules from .gitlab-ci.yml
    const gitCheckRules = await parseGitCheckRules(workspaceRoot);

    // Get status first to check if we have changes
    const status = await gitService.getStatus();
    const hasChanges = status.modified.length > 0 ||
      status.created.length > 0 ||
      status.deleted.length > 0 ||
      status.not_added.length > 0;

    if (!hasChanges) {
      vscode.window.showInformationMessage('No changes to process');
      return;
    }

    const currentBranch = await gitService.getCurrentBranch();
    let branchToUse = currentBranch;
    
    // Check if ticket number is required (for branch or commit)
    let ticketNumber: string | undefined;
    const needsTicket = gitCheckRules.requiresTicketNumber || gitCheckRules.commitRequiresTicketNumber;
    
    if (needsTicket) {
      ticketNumber = await vscode.window.showInputBox({
        prompt: 'Enter ticket number (e.g., JIRA-123, ABC-456)',
        placeHolder: 'TASK-001',
        validateInput: (value) => {
          if (!value || !/^[A-Z]+-[0-9]+$/i.test(value)) {
            return 'Ticket number must be in format: ABC-123';
          }
          return null;
        }
      });
      
      if (!ticketNumber) {
        ticketNumber = 'TASK-001'; // Default fallback
      }
      ticketNumber = ticketNumber.toUpperCase();
    }

    // Check if we're on a protected branch - ALWAYS create a new branch
    if (isProtectedBranch(currentBranch)) {
      vscode.window.showInformationMessage(`Creating new branch from ${currentBranch}...`);

      // Get diff to generate appropriate branch name
      const allDiff = await gitService.getAllDiff();

      // Generate branch name automatically
      const branchInstructions = getBranchNamingInstructions(gitCheckRules, ticketNumber);
      const generatedBranchName = await llmService.generateBranchNameWithRules(allDiff, branchInstructions);

      // Validate generated branch name
      const branchValidation = validateBranchName(generatedBranchName, gitCheckRules);
      if (!branchValidation.valid) {
        vscode.window.showErrorMessage(`Cannot create valid branch name: ${branchValidation.error}`);
        return;
      }

      branchToUse = generatedBranchName;
      await gitService.createBranch(generatedBranchName, true);
      vscode.window.showInformationMessage(`Created branch: ${generatedBranchName}`);
    }

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'GitLab AI: Full Workflow',
      cancellable: true
    }, async (progress, token) => {
      // Step 1: Stage and Commit
      progress.report({ message: 'Staging changes...', increment: 10 });
      
      if (token.isCancellationRequested) {return;}

      await gitService.stageAll();

      progress.report({ message: 'Generating commit message...', increment: 10 });
      
      const diff = await gitService.getStagedDiff();
      
      // Generate commit message automatically (no user input)
      const commitInstructions = getCommitMessageInstructions(gitCheckRules, ticketNumber);
      const commitMessage = await llmService.generateCommitMessageWithRules(diff, commitInstructions, ticketNumber);

      // Validate generated commit message
      const commitValidation = validateCommitMessage(commitMessage, gitCheckRules);
      if (!commitValidation.valid) {
        vscode.window.showErrorMessage(`Generated commit message is invalid: ${commitValidation.error}`);
        return;
      }

      if (token.isCancellationRequested) {return;}

      // Show confirmation (no editing allowed)
      const confirmCommit = await vscode.window.showInformationMessage(
        `Commit: "${commitMessage.split('\n')[0]}"`,
        'Continue',
        'Cancel'
      );

      if (confirmCommit !== 'Continue') {
        return;
      }

      progress.report({ message: 'Committing...', increment: 10 });
      await gitService.commit(commitMessage);

      if (token.isCancellationRequested) {return;}

      // Step 2: Push to remote
      progress.report({ message: 'Pushing to remote...', increment: 15 });
      
      try {
        await gitService.push('origin', branchToUse, true);
      } catch {
        await gitService.push('origin', branchToUse);
      }

      if (token.isCancellationRequested) {return;}

      // Step 3: Get project info
      progress.report({ message: 'Fetching project info...', increment: 10 });
      
      const remoteUrl = await gitService.getRemoteUrl();
      if (!remoteUrl) {
        throw new Error('No remote origin found');
      }

      const projectInfo = GitService.parseGitLabUrl(remoteUrl);
      if (!projectInfo) {
        throw new Error('Could not parse GitLab project info');
      }

      const project = await gitlabService.getProject(`${projectInfo.namespace}/${projectInfo.project}`);

      if (token.isCancellationRequested) {return;}

      // Step 4: Check for existing MR
      const existingMRs = await gitlabService.listMergeRequests(project.id, {
        state: 'opened',
        sourceBranch: branchToUse
      });

      let mr;
      
      if (existingMRs.length > 0) {
        mr = existingMRs[0];
        vscode.window.showInformationMessage(`Using existing MR #${mr.iid}`);
      } else {
        // Step 5: Create MR
        progress.report({ message: 'Generating MR description...', increment: 10 });

        // Prioritize dev branches over main/master for MR target
        const targetBranch = config.defaultTargetBranch || await gitService.getMRTargetBranch();
        const commits = await gitService.getCommitsBetween(targetBranch, branchToUse);
        const branchDiff = await gitService.getDiffWithBranch(targetBranch);

        // Load MR template if exists
        let mrTemplate = '';
        if (config.mrTemplate) {
          try {
            mrTemplate = await fs.readFile(path.join(workspaceRoot, config.mrTemplate), 'utf-8');
          } catch {
            // Continue without template
          }
        }

        const { title: suggestedTitle, description: suggestedDescription } = await llmService.generateMRDescription(
          branchToUse,
          commits,
          branchDiff,
          mrTemplate
        );

        if (token.isCancellationRequested) {return;}

        const finalTitle = await vscode.window.showInputBox({
          prompt: 'MR Title',
          value: suggestedTitle
        });

        if (!finalTitle) {
          return;
        }

        progress.report({ message: 'Creating merge request...', increment: 10 });

        mr = await gitlabService.createMergeRequest(
          project.id,
          branchToUse,
          targetBranch,
          finalTitle,
          suggestedDescription,
          {
            draft: config.enableDraftMR,
            removeSourceBranch: true
          }
        );
      }

      if (token.isCancellationRequested) {return;}

      // Step 6: Run code review
      progress.report({ message: 'Running AI code review...', increment: 15 });

      // Wait for GitLab to process the MR changes (especially for newly created MRs)
      let changes = await gitlabService.getMergeRequestChanges(project.id, mr.iid);
      
      // Retry logic: GitLab may need time to populate changes for new MRs
      let retryCount = 0;
      const maxRetries = 5;
      while (changes.length === 0 && retryCount < maxRetries) {
        retryCount++;
        progress.report({ message: `Waiting for GitLab to process changes (attempt ${retryCount}/${maxRetries})...` });
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
        changes = await gitlabService.getMergeRequestChanges(project.id, mr.iid);
      }

      if (changes.length === 0) {
        vscode.window.showWarningMessage('No changes found in MR. Review skipped.');
        vscode.env.openExternal(vscode.Uri.parse(mr.web_url));
        return;
      }

      const reviewDiff = changes.map(change => {
        return `--- a/${change.old_path}\n+++ b/${change.new_path}\n${change.diff}`;
      }).join('\n\n');

      const businessContext = await loadBusinessContext(workspaceRoot, config.businessContextFile);
      const review = await llmService.reviewCode(reviewDiff, config.reviewMode, businessContext);

      if (token.isCancellationRequested) {return;}

      // Step 7: Post review to GitLab
      progress.report({ message: 'Posting review comments...', increment: 10 });

      // Post summary
      const summaryComment = `## 🤖 AI Code Review

**Score: ${review.score}/100**

${review.summary}

${review.comments.length > 0 ? `### Issues Found: ${review.comments.length}

| Severity | File | Line | Issue |
|----------|------|------|-------|
${review.comments.slice(0, 10).map(c => 
  `| ${c.severity} | ${c.file} | ${c.line} | ${c.message.substring(0, 50)}... |`
).join('\n')}
${review.comments.length > 10 ? `\n*...and ${review.comments.length - 10} more*` : ''}` : ''}

---
*This review was generated by GitLab AI Assistant*`;

      await gitlabService.createMRNote(project.id, mr.iid, summaryComment);

      // Post top inline comments (limit to avoid spam)
      const topComments = review.comments
        .filter(c => c.severity === 'error' || c.severity === 'warning')
        .slice(0, 5);

      for (const comment of topComments) {
        if (comment.file && comment.line && mr.diff_refs) {
          try {
            const change = changes.find(c => 
              c.new_path === comment.file || c.old_path === comment.file
            );
            
            if (change) {
              const severityIcon = { error: '❌', warning: '⚠️' }[comment.severity] || '•';
              let body = `${severityIcon} **[${comment.category.toUpperCase()}]** ${comment.message}`;
              if (comment.suggestion) {
                body += `\n\n💡 **Suggestion:** ${comment.suggestion}`;
              }

              await gitlabService.createMRDiscussion(project.id, mr.iid, body, {
                baseSha: mr.diff_refs.base_sha,
                startSha: mr.diff_refs.start_sha,
                headSha: mr.diff_refs.head_sha,
                oldPath: change.old_path,
                newPath: change.new_path,
                newLine: comment.line
              });
            }
          } catch {
            // Continue with other comments
          }
        }
      }

      // Done!
      const action = await vscode.window.showInformationMessage(
        `✅ Workflow complete! MR #${mr.iid} created with AI review (Score: ${review.score}/100)`,
        'Open MR',
        'View Full Review'
      );

      if (action === 'Open MR') {
        vscode.env.openExternal(vscode.Uri.parse(mr.web_url));
      } else if (action === 'View Full Review') {
        // Show full review in output
        const outputChannel = vscode.window.createOutputChannel('GitLab AI Code Review');
        outputChannel.clear();
        outputChannel.appendLine('═'.repeat(60));
        outputChannel.appendLine(`  CODE REVIEW: MR #${mr.iid}`);
        outputChannel.appendLine('═'.repeat(60));
        outputChannel.appendLine('');
        outputChannel.appendLine(`Score: ${review.score}/100`);
        outputChannel.appendLine('');
        outputChannel.appendLine(review.summary);
        outputChannel.appendLine('');
        
        for (const comment of review.comments) {
          const icon = { error: '❌', warning: '⚠️', info: 'ℹ️', suggestion: '💡' }[comment.severity] || '•';
          outputChannel.appendLine(`${icon} ${comment.file}:${comment.line} - ${comment.message}`);
        }
        
        outputChannel.show();
      }
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    vscode.window.showErrorMessage(`Workflow failed: ${message}`);
  }
}