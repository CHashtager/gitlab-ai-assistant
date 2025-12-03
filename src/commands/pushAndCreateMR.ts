import * as vscode from 'vscode';
import { GitService } from '../services/gitService';
import { GitLabService } from '../services/gitlabService';
import { LLMService } from '../services/llmService';
import { ConfigManager, getWorkspaceFolder } from '../utils/config';
import { isProtectedBranch } from '../utils/gitCheckParser';
import * as fs from 'fs/promises';
import * as path from 'path';

export async function pushAndCreateMRCommand(): Promise<void> {
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
    const currentBranch = await gitService.getCurrentBranch();
    
    // NEVER push to protected branches - enforce strictly
    if (isProtectedBranch(currentBranch)) {
      vscode.window.showErrorMessage(
        `Cannot push to protected branch "${currentBranch}". Please create a feature branch first using "GitLab AI: Create Branch" or "GitLab AI: Full Workflow".`
      );
      return;
    }

    // Get remote URL and parse project info
    const remoteUrl = await gitService.getRemoteUrl();
    if (!remoteUrl) {
      vscode.window.showErrorMessage('No remote origin found. Please add a remote first.');
      return;
    }

    const projectInfo = GitService.parseGitLabUrl(remoteUrl);
    if (!projectInfo) {
      vscode.window.showErrorMessage('Could not parse GitLab project info from remote URL');
      return;
    }

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Creating Merge Request...',
      cancellable: false
    }, async (progress) => {
      // Step 1: Push the branch
      progress.report({ message: 'Pushing branch to remote...', increment: 20 });
      
      try {
        await gitService.push('origin', currentBranch, true);
      } catch (error) {
        // Branch might already exist on remote, try regular push
        await gitService.push('origin', currentBranch);
      }

      // Step 2: Get project from GitLab
      progress.report({ message: 'Fetching project info...', increment: 20 });
      
      const projectPath = `${projectInfo.namespace}/${projectInfo.project}`;
      const project = await gitlabService.getProject(projectPath);

      // Step 3: Check if MR already exists
      const existingMRs = await gitlabService.listMergeRequests(project.id, {
        state: 'opened',
        sourceBranch: currentBranch
      });

      if (existingMRs.length > 0) {
        const existingMR = existingMRs[0];
        const action = await vscode.window.showInformationMessage(
          `MR #${existingMR.iid} already exists for this branch.`,
          'Open MR',
          'Update MR',
          'Cancel'
        );

        if (action === 'Open MR') {
          vscode.env.openExternal(vscode.Uri.parse(existingMR.web_url));
        } else if (action === 'Update MR') {
          // Could add update logic here
          vscode.env.openExternal(vscode.Uri.parse(existingMR.web_url));
        }
        return;
      }

      // Step 4: Generate MR description
      progress.report({ message: 'Generating MR description...', increment: 20 });

      // Get commits for this branch - prioritize dev branches over main/master
      const targetBranch = config.defaultTargetBranch || await gitService.getMRTargetBranch();
      const commits = await gitService.getCommitsBetween(targetBranch, currentBranch);
      const diff = await gitService.getDiffWithBranch(targetBranch);

      // Load MR template if exists
      let mrTemplate = '';
      if (config.mrTemplate) {
        try {
          mrTemplate = await fs.readFile(path.join(workspaceRoot, config.mrTemplate), 'utf-8');
        } catch {
          // Template not found, continue without it
        }
      }

      const { title: suggestedTitle, description: suggestedDescription } = await llmService.generateMRDescription(
        currentBranch,
        commits,
        diff,
        mrTemplate
      );

      // Step 5: Let user confirm/edit title and description
      progress.report({ message: 'Waiting for confirmation...', increment: 20 });

      const finalTitle = await vscode.window.showInputBox({
        prompt: 'MR Title',
        value: suggestedTitle,
        validateInput: (value) => value?.trim() ? null : 'Title is required'
      });

      if (!finalTitle) {
        return;
      }

      // Show description in a document for editing
      const descriptionDoc = await vscode.workspace.openTextDocument({
        content: suggestedDescription,
        language: 'markdown'
      });
      
      const editor = await vscode.window.showTextDocument(descriptionDoc, {
        preview: false,
        viewColumn: vscode.ViewColumn.Beside
      });

      const confirmed = await vscode.window.showInformationMessage(
        'Edit the MR description in the editor, then click "Create MR"',
        'Create MR',
        'Cancel'
      );

      if (confirmed !== 'Create MR') {
        return;
      }

      const finalDescription = descriptionDoc.getText();

      // Close the description document
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

      // Step 6: Create the MR
      progress.report({ message: 'Creating merge request...', increment: 20 });

      const mr = await gitlabService.createMergeRequest(
        project.id,
        currentBranch,
        targetBranch,
        finalTitle,
        finalDescription,
        {
          draft: config.enableDraftMR,
          removeSourceBranch: true
        }
      );

      // Show success message with link
      const openMR = await vscode.window.showInformationMessage(
        `Merge Request #${mr.iid} created successfully!`,
        'Open MR',
        'Start AI Review'
      );

      if (openMR === 'Open MR') {
        vscode.env.openExternal(vscode.Uri.parse(mr.web_url));
      } else if (openMR === 'Start AI Review') {
        // Trigger the review command with this MR
        vscode.commands.executeCommand('gitlabAI.reviewMR', { projectId: project.id, mrIid: mr.iid });
      }
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    vscode.window.showErrorMessage(`Failed to create MR: ${message}`);
  }
}