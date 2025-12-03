import * as vscode from 'vscode';
import {
  createBranchCommand,
  commitChangesCommand,
  pushAndCreateMRCommand,
  reviewCodeCommand,
  reviewMRCommand,
  fullWorkflowCommand,
  configureCommand,
  clearDiagnostics
} from './commands';

export function activate(context: vscode.ExtensionContext) {
  console.log('GitLab AI Assistant is now active!');

  // Register commands
  const commands = [
    vscode.commands.registerCommand('gitlabAI.createBranch', createBranchCommand),
    vscode.commands.registerCommand('gitlabAI.commitChanges', commitChangesCommand),
    vscode.commands.registerCommand('gitlabAI.pushAndCreateMR', pushAndCreateMRCommand),
    vscode.commands.registerCommand('gitlabAI.reviewCode', reviewCodeCommand),
    vscode.commands.registerCommand('gitlabAI.reviewMR', reviewMRCommand),
    vscode.commands.registerCommand('gitlabAI.fullWorkflow', fullWorkflowCommand),
    vscode.commands.registerCommand('gitlabAI.configure', configureCommand)
  ];

  // Add all commands to subscriptions
  commands.forEach(cmd => context.subscriptions.push(cmd));

  // Show welcome message on first activation
  const hasShownWelcome = context.globalState.get('gitlabAI.hasShownWelcome');
  if (!hasShownWelcome) {
    showWelcomeMessage();
    context.globalState.update('gitlabAI.hasShownWelcome', true);
  }

  // Create status bar item
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBarItem.text = '$(git-merge) GitLab AI';
  statusBarItem.tooltip = 'GitLab AI Assistant - Click for quick actions';
  statusBarItem.command = 'gitlabAI.showQuickPick';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Register quick pick command
  context.subscriptions.push(
    vscode.commands.registerCommand('gitlabAI.showQuickPick', showQuickPick)
  );

  // Clean up diagnostics on deactivation
  context.subscriptions.push({
    dispose: () => clearDiagnostics()
  });
}

async function showWelcomeMessage(): Promise<void> {
  const action = await vscode.window.showInformationMessage(
    'Welcome to GitLab AI Assistant! Configure your GitLab and AI settings to get started.',
    'Configure Now',
    'Later'
  );

  if (action === 'Configure Now') {
    vscode.commands.executeCommand('gitlabAI.configure');
  }
}

async function showQuickPick(): Promise<void> {
  const items = [
    {
      label: '$(git-branch) Create Branch',
      description: 'Create a new branch with AI-generated name',
      command: 'gitlabAI.createBranch'
    },
    {
      label: '$(git-commit) Commit Changes',
      description: 'Commit with AI-generated message',
      command: 'gitlabAI.commitChanges'
    },
    {
      label: '$(git-pull-request) Push & Create MR',
      description: 'Push changes and create merge request',
      command: 'gitlabAI.pushAndCreateMR'
    },
    {
      label: '$(eye) Review Current Changes',
      description: 'AI review of local changes',
      command: 'gitlabAI.reviewCode'
    },
    {
      label: '$(comment-discussion) Review Merge Request',
      description: 'AI review of an MR with GitLab comments',
      command: 'gitlabAI.reviewMR'
    },
    {
      label: '$(rocket) Full Workflow',
      description: 'Branch → Commit → Push → MR → Review',
      command: 'gitlabAI.fullWorkflow'
    },
    {
      label: '$(separator)',
      kind: vscode.QuickPickItemKind.Separator
    } as any,
    {
      label: '$(gear) Configure',
      description: 'Set up GitLab and AI settings',
      command: 'gitlabAI.configure'
    }
  ];

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'GitLab AI Assistant - Select action'
  });

  if (selected && 'command' in selected) {
    vscode.commands.executeCommand(selected.command);
  }
}

export function deactivate() {
  clearDiagnostics();
}