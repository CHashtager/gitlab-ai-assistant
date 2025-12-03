import * as vscode from 'vscode';
import { GitService } from '../services/gitService';
import { LLMService } from '../services/llmService';
import { ConfigManager, getWorkspaceFolder } from '../utils/config';
import { 
  parseGitCheckRules, 
  isProtectedBranch,
  getCommitMessageInstructions,
  validateCommitMessage,
  getBranchNamingInstructions
} from '../utils/gitCheckParser';

export async function commitChangesCommand(): Promise<void> {
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
    // Check current branch - NEVER commit directly to protected branches
    const currentBranch = await gitService.getCurrentBranch();
    if (isProtectedBranch(currentBranch)) {
      const createBranch = await vscode.window.showErrorMessage(
        `Cannot commit directly to protected branch "${currentBranch}". Create a new branch first.`,
        'Create Branch'
      );
      if (createBranch === 'Create Branch') {
        // Parse git-check rules
        const gitCheckRules = await parseGitCheckRules(workspaceRoot);
        const diff = await gitService.getAllDiff();
        
        if (diff && diff.trim().length > 0) {
          // Check if ticket number is required
          let ticketNumber: string | undefined;
          if (gitCheckRules.requiresTicketNumber) {
            ticketNumber = await vscode.window.showInputBox({
              prompt: 'Enter ticket number (e.g., JIRA-123, ABC-456)',
              placeHolder: 'TASK-001'
            });
            ticketNumber = ticketNumber?.toUpperCase() || 'TASK-001';
          }
          
          const rulesInstructions = getBranchNamingInstructions(gitCheckRules, ticketNumber);
          const branchName = await llmService.generateBranchNameWithRules(diff, rulesInstructions);
          vscode.window.showInformationMessage(`Generated branch name: ${branchName}`);
          await gitService.createBranch(branchName, true);
          vscode.window.showInformationMessage(`Created and switched to branch: ${branchName}. You can now commit.`);
        }
      }
      return;
    }

    // Get status
    const status = await gitService.getStatus();
    
    // Check if there are any changes
    const hasChanges = status.modified.length > 0 ||
      status.created.length > 0 ||
      status.deleted.length > 0 ||
      status.not_added.length > 0 ||
      status.staged.length > 0;

    if (!hasChanges) {
      vscode.window.showInformationMessage('No changes to commit');
      return;
    }

    // Parse git-check rules from .gitlab-ci.yml
    const gitCheckRules = await parseGitCheckRules(workspaceRoot);

    // Ask if user wants to stage all changes or select files
    const stageOption = await vscode.window.showQuickPick([
      { label: 'Stage All Changes', value: 'all' },
      { label: 'Use Currently Staged Files', value: 'staged' },
      { label: 'Select Files to Stage', value: 'select' }
    ], {
      placeHolder: 'How would you like to stage changes?'
    });

    if (!stageOption) {
      return;
    }

    if (stageOption.value === 'all') {
      await gitService.stageAll();
    } else if (stageOption.value === 'select') {
      // Show file picker
      const allFiles = [
        ...status.modified.map(f => ({ label: `M ${f}`, path: f })),
        ...status.created.map(f => ({ label: `A ${f}`, path: f })),
        ...status.deleted.map(f => ({ label: `D ${f}`, path: f })),
        ...status.not_added.map(f => ({ label: `? ${f}`, path: f }))
      ];

      const selectedFiles = await vscode.window.showQuickPick(allFiles, {
        placeHolder: 'Select files to stage',
        canPickMany: true
      });

      if (!selectedFiles || selectedFiles.length === 0) {
        vscode.window.showWarningMessage('No files selected');
        return;
      }

      await gitService.stageFiles(selectedFiles.map(f => f.path));
    } else if (stageOption.value === 'staged') {
      // Check if there are staged files
      if (status.staged.length === 0) {
        vscode.window.showWarningMessage('No files are staged. Please stage files first.');
        return;
      }
    }

    // Get the diff for staged files
    const diff = await gitService.getStagedDiff();
    
    if (!diff || diff.trim().length === 0) {
      vscode.window.showWarningMessage('No staged changes to commit');
      return;
    }

    // Check if ticket number is required for commit message
    let ticketNumber: string | undefined;
    if (gitCheckRules.commitRequiresTicketNumber || gitCheckRules.requiresTicketNumber) {
      ticketNumber = await vscode.window.showInputBox({
        prompt: 'Enter ticket number for commit message (e.g., JIRA-123, ABC-456)',
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

    // Generate commit message using AI (no user input required)
    let commitMessage = '';
    
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Generating commit message...',
      cancellable: false
    }, async () => {
      const rulesInstructions = getCommitMessageInstructions(gitCheckRules, ticketNumber);
      commitMessage = await llmService.generateCommitMessageWithRules(diff, rulesInstructions, ticketNumber);
      vscode.window.showInformationMessage(`Generated commit message: ${commitMessage}`);
    });

    // Validate the generated commit message
    const validation = validateCommitMessage(commitMessage, gitCheckRules);
    if (!validation.valid) {
      vscode.window.showErrorMessage(`Generated commit message is invalid: ${validation.error}`);
      return;
    }

    // Show the generated message for confirmation (but no editing)
    const confirmCommit = await vscode.window.showInformationMessage(
      `Commit message: "${commitMessage.split('\n')[0]}"`,
      'Commit',
      'Cancel'
    );

    if (confirmCommit !== 'Commit') {
      return;
    }

    // Commit
    const commitHash = await gitService.commit(commitMessage);
    
    vscode.window.showInformationMessage(
      `Changes committed successfully (${commitHash.substring(0, 7)})`,
      'Push Changes'
    ).then(action => {
      if (action === 'Push Changes') {
        vscode.commands.executeCommand('gitlabAI.pushAndCreateMR');
      }
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    vscode.window.showErrorMessage(`Failed to commit: ${message}`);
  }
}