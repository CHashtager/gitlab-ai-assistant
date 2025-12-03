import * as vscode from 'vscode';
import { GitService } from '../services/gitService';
import { GitLabService } from '../services/gitlabService';
import { LLMService } from '../services/llmService';
import { ConfigManager, getWorkspaceFolder } from '../utils/config';
import { loadBusinessContext } from '../utils/businessContext';

interface ReviewCommandArgs {
  projectId?: number;
  mrIid?: number;
}

export async function reviewCodeCommand(): Promise<void> {
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
  const llmService = new LLMService(config);

  // Check if it's a git repository
  if (!await gitService.isGitRepository()) {
    vscode.window.showErrorMessage('Current folder is not a git repository');
    return;
  }

  try {
    // Get current changes
    const diff = await gitService.getAllDiff();
    
    if (!diff || diff.trim().length === 0) {
      vscode.window.showInformationMessage('No changes to review');
      return;
    }

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Reviewing code...',
      cancellable: false
    }, async (progress) => {
      // Load business context if available
      progress.report({ message: 'Loading context...', increment: 10 });
      const businessContext = await loadBusinessContext(workspaceRoot, config.businessContextFile);

      // Perform review
      progress.report({ message: 'Analyzing changes...', increment: 40 });
      const review = await llmService.reviewCode(diff, config.reviewMode, businessContext);

      // Display results
      progress.report({ message: 'Preparing results...', increment: 50 });
      
      // Create output channel for review results
      const outputChannel = vscode.window.createOutputChannel('GitLab AI Code Review');
      outputChannel.clear();
      
      outputChannel.appendLine('═'.repeat(60));
      outputChannel.appendLine('  CODE REVIEW RESULTS');
      outputChannel.appendLine('═'.repeat(60));
      outputChannel.appendLine('');
      outputChannel.appendLine(`Overall Score: ${review.score}/100`);
      outputChannel.appendLine('');
      outputChannel.appendLine('Summary:');
      outputChannel.appendLine(review.summary);
      outputChannel.appendLine('');

      if (review.comments.length > 0) {
        outputChannel.appendLine('─'.repeat(60));
        outputChannel.appendLine('Comments:');
        outputChannel.appendLine('');

        // Group comments by file
        const commentsByFile = review.comments.reduce((acc, comment) => {
          const file = comment.file || 'General';
          if (!acc[file]) {
            acc[file] = [];
          }
          acc[file].push(comment);
          return acc;
        }, {} as Record<string, typeof review.comments>);

        for (const [file, comments] of Object.entries(commentsByFile)) {
          outputChannel.appendLine(`📁 ${file}`);
          for (const comment of comments) {
            const severityIcon = {
              error: '❌',
              warning: '⚠️',
              info: 'ℹ️',
              suggestion: '💡'
            }[comment.severity] || '•';

            outputChannel.appendLine(`  ${severityIcon} Line ${comment.line}: [${comment.category}] ${comment.message}`);
            if (comment.suggestion) {
              outputChannel.appendLine(`     💡 Suggestion: ${comment.suggestion}`);
            }
          }
          outputChannel.appendLine('');
        }
      }

      outputChannel.appendLine('═'.repeat(60));
      outputChannel.show();

      // Also create diagnostics for inline display
      await createDiagnostics(workspaceRoot, review.comments);
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    vscode.window.showErrorMessage(`Failed to review code: ${message}`);
  }
}

export async function reviewMRCommand(args?: ReviewCommandArgs): Promise<void> {
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
    let projectId = args?.projectId;
    let mrIid = args?.mrIid;

    // If not provided, try to find from current branch
    if (!projectId || !mrIid) {
      const remoteUrl = await gitService.getRemoteUrl();
      if (!remoteUrl) {
        vscode.window.showErrorMessage('No remote origin found');
        return;
      }

      const projectInfo = GitService.parseGitLabUrl(remoteUrl);
      if (!projectInfo) {
        vscode.window.showErrorMessage('Could not parse GitLab project info');
        return;
      }

      const project = await gitlabService.getProject(`${projectInfo.namespace}/${projectInfo.project}`);
      projectId = project.id;

      // Find MR for current branch
      const currentBranch = await gitService.getCurrentBranch();
      const mrs = await gitlabService.listMergeRequests(projectId, {
        state: 'opened',
        sourceBranch: currentBranch
      });

      if (mrs.length === 0) {
        // Let user enter MR number
        const mrInput = await vscode.window.showInputBox({
          prompt: 'Enter MR number to review',
          placeHolder: '123',
          validateInput: (value) => {
            const num = parseInt(value);
            return isNaN(num) ? 'Please enter a valid MR number' : null;
          }
        });

        if (!mrInput) {
          return;
        }

        mrIid = parseInt(mrInput);
      } else if (mrs.length === 1) {
        mrIid = mrs[0].iid;
      } else {
        // Let user select
        const selected = await vscode.window.showQuickPick(
          mrs.map(mr => ({
            label: `#${mr.iid}: ${mr.title}`,
            description: `${mr.source_branch} → ${mr.target_branch}`,
            mr
          })),
          { placeHolder: 'Select MR to review' }
        );

        if (!selected) {
          return;
        }

        mrIid = selected.mr.iid;
      }
    }

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Reviewing Merge Request...',
      cancellable: false
    }, async (progress) => {
      // Get MR details
      progress.report({ message: 'Fetching MR changes...', increment: 20 });
      
      const mr = await gitlabService.getMergeRequest(projectId!, mrIid!);
      const changes = await gitlabService.getMergeRequestChanges(projectId!, mrIid!);

      // Build diff string from changes
      const diff = changes.map(change => {
        return `--- a/${change.old_path}\n+++ b/${change.new_path}\n${change.diff}`;
      }).join('\n\n');

      // Load business context
      progress.report({ message: 'Loading context...', increment: 10 });
      const businessContext = await loadBusinessContext(workspaceRoot, config.businessContextFile);

      // Perform review
      progress.report({ message: 'Analyzing changes...', increment: 30 });
      const review = await llmService.reviewCode(diff, config.reviewMode, businessContext);

      // Ask if user wants to post comments to GitLab
      progress.report({ message: 'Preparing comments...', increment: 20 });

      const action = await vscode.window.showInformationMessage(
        `Review complete (Score: ${review.score}/100). Found ${review.comments.length} comments.`,
        'Post to GitLab',
        'View Locally',
        'Cancel'
      );

      if (action === 'Cancel') {
        return;
      }

      if (action === 'Post to GitLab') {
        progress.report({ message: 'Posting comments to GitLab...', increment: 20 });

        // Post summary as MR note
        const summaryComment = `## 🤖 AI Code Review\n\n**Score: ${review.score}/100**\n\n${review.summary}\n\n---\n*This review was generated by GitLab AI Assistant*`;
        await gitlabService.createMRNote(projectId!, mrIid!, summaryComment);

        // Post inline comments as discussions
        for (const comment of review.comments) {
          if (comment.file && comment.line) {
            try {
              const change = changes.find(c => c.new_path === comment.file || c.old_path === comment.file);
              if (change && mr.diff_refs) {
                const severityIcon = {
                  error: '❌',
                  warning: '⚠️',
                  info: 'ℹ️',
                  suggestion: '💡'
                }[comment.severity] || '•';

                let body = `${severityIcon} **[${comment.category.toUpperCase()}]** ${comment.message}`;
                if (comment.suggestion) {
                  body += `\n\n💡 **Suggestion:** ${comment.suggestion}`;
                }

                await gitlabService.createMRDiscussion(projectId!, mrIid!, body, {
                  baseSha: mr.diff_refs.base_sha,
                  startSha: mr.diff_refs.start_sha,
                  headSha: mr.diff_refs.head_sha,
                  oldPath: change.old_path,
                  newPath: change.new_path,
                  newLine: comment.line
                });
              }
            } catch (err) {
              // Some comments might fail due to line mapping issues, continue with others
              console.error('Failed to post inline comment:', err);
            }
          }
        }

        vscode.window.showInformationMessage('Review posted to GitLab!', 'Open MR').then(action => {
          if (action === 'Open MR') {
            vscode.env.openExternal(vscode.Uri.parse(mr.web_url));
          }
        });
      } else {
        // View locally
        const outputChannel = vscode.window.createOutputChannel('GitLab AI Code Review');
        outputChannel.clear();
        
        outputChannel.appendLine('═'.repeat(60));
        outputChannel.appendLine(`  CODE REVIEW: MR #${mrIid}`);
        outputChannel.appendLine('═'.repeat(60));
        outputChannel.appendLine('');
        outputChannel.appendLine(`Title: ${mr.title}`);
        outputChannel.appendLine(`Branch: ${mr.source_branch} → ${mr.target_branch}`);
        outputChannel.appendLine('');
        outputChannel.appendLine(`Overall Score: ${review.score}/100`);
        outputChannel.appendLine('');
        outputChannel.appendLine('Summary:');
        outputChannel.appendLine(review.summary);
        outputChannel.appendLine('');

        if (review.comments.length > 0) {
          outputChannel.appendLine('─'.repeat(60));
          outputChannel.appendLine('Comments:');
          outputChannel.appendLine('');

          for (const comment of review.comments) {
            const severityIcon = {
              error: '❌',
              warning: '⚠️',
              info: 'ℹ️',
              suggestion: '💡'
            }[comment.severity] || '•';

            outputChannel.appendLine(`${severityIcon} ${comment.file}:${comment.line}`);
            outputChannel.appendLine(`   [${comment.category}] ${comment.message}`);
            if (comment.suggestion) {
              outputChannel.appendLine(`   💡 ${comment.suggestion}`);
            }
            outputChannel.appendLine('');
          }
        }

        outputChannel.appendLine('═'.repeat(60));
        outputChannel.show();
      }
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    vscode.window.showErrorMessage(`Failed to review MR: ${message}`);
  }
}

// Helper function to create VS Code diagnostics
const diagnosticCollection = vscode.languages.createDiagnosticCollection('gitlab-ai-review');

async function createDiagnostics(
  workspaceRoot: string,
  comments: Array<{ file: string; line: number; severity: string; message: string }>
): Promise<void> {
  diagnosticCollection.clear();

  const diagnosticsByUri = new Map<string, vscode.Diagnostic[]>();

  for (const comment of comments) {
    if (!comment.file || !comment.line) {continue;}

    const uri = vscode.Uri.file(`${workspaceRoot}/${comment.file}`);
    const uriString = uri.toString();

    if (!diagnosticsByUri.has(uriString)) {
      diagnosticsByUri.set(uriString, []);
    }

    const severity = {
      error: vscode.DiagnosticSeverity.Error,
      warning: vscode.DiagnosticSeverity.Warning,
      info: vscode.DiagnosticSeverity.Information,
      suggestion: vscode.DiagnosticSeverity.Hint
    }[comment.severity] || vscode.DiagnosticSeverity.Information;

    const line = Math.max(0, comment.line - 1);
    const range = new vscode.Range(line, 0, line, 1000);
    
    const diagnostic = new vscode.Diagnostic(range, comment.message, severity);
    diagnostic.source = 'GitLab AI';

    diagnosticsByUri.get(uriString)!.push(diagnostic);
  }

  for (const [uriString, diagnostics] of diagnosticsByUri) {
    diagnosticCollection.set(vscode.Uri.parse(uriString), diagnostics);
  }
}

export function clearDiagnostics(): void {
  diagnosticCollection.clear();
}