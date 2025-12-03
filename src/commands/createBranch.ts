import * as vscode from 'vscode';
import { GitService } from '../services/gitService';
import { LLMService } from '../services/llmService';
import { ConfigManager, getWorkspaceFolder } from '../utils/config';
import { 
  parseGitCheckRules, 
  isProtectedBranch, 
  getBranchNamingInstructions,
  validateBranchName 
} from '../utils/gitCheckParser';

export async function createBranchCommand(): Promise<void> {
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
    // Check current branch - cannot stay on protected branches
    const currentBranch = await gitService.getCurrentBranch();
    if (!isProtectedBranch(currentBranch)) {
      const switchBranch = await vscode.window.showInformationMessage(
        `You're already on branch "${currentBranch}". Do you want to create a new branch instead?`,
        'Create New Branch',
        'Stay on Current'
      );
      if (switchBranch !== 'Create New Branch') {
        return;
      }
    }

    // Parse git-check rules from .gitlab-ci.yml
    const gitCheckRules = await parseGitCheckRules(workspaceRoot);
    
    // Get the diff to understand what changes need a branch
    const diff = await gitService.getAllDiff();
    
    if (!diff || diff.trim().length === 0) {
      vscode.window.showWarningMessage('No changes detected. Make some changes first before creating a branch.');
      return;
    }

    // Check if ticket number is required by the pattern
    let ticketNumber: string | undefined;
    if (gitCheckRules.requiresTicketNumber) {
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

    // Generate branch name using AI
    let branchName = '';
    
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Generating branch name...',
      cancellable: false
    }, async () => {
      const rulesInstructions = getBranchNamingInstructions(gitCheckRules, ticketNumber);
      branchName = await llmService.generateBranchNameWithRules(diff, rulesInstructions);
      vscode.window.showInformationMessage(`Generated branch name: ${branchName}`);
    });

    // Validate the generated branch name
    const validation = validateBranchName(branchName, gitCheckRules);
    if (!validation.valid) {
      vscode.window.showErrorMessage(`Generated branch name is invalid: ${validation.error}`);
      return;
    }

    // Check if branch already exists
    const branches = await gitService.getBranches();
    if (branches.includes(branchName)) {
      const checkout = await vscode.window.showWarningMessage(
        `Branch "${branchName}" already exists. Switch to it?`,
        'Yes',
        'No'
      );
      if (checkout === 'Yes') {
        await gitService.checkoutBranch(branchName);
        vscode.window.showInformationMessage(`Switched to branch: ${branchName}`);
      }
      return;
    }

    // Create and checkout the branch
    await gitService.createBranch(branchName, true);
    vscode.window.showInformationMessage(`Created and switched to branch: ${branchName}`);

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    vscode.window.showErrorMessage(`Failed to create branch: ${message}`);
  }
}