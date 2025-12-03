import * as vscode from 'vscode';
import { ConfigManager } from '../utils/config';
import { BusinessContextLoader } from '../utils/businessContext';
import { GitLabService } from '../services/gitlabService';

export async function configureCommand(): Promise<void> {
  const options = [
    { label: '$(key) Configure GitLab Connection', value: 'gitlab' },
    { label: '$(hubot) Configure AI/LLM Settings', value: 'llm' },
    { label: '$(git-branch) Configure Branch Naming', value: 'branch' },
    { label: '$(git-commit) Configure Commit Messages', value: 'commit' },
    { label: '$(eye) Configure Code Review', value: 'review' },
    { label: '$(file-text) Create Business Context File', value: 'context' },
    { label: '$(check) Test Configuration', value: 'test' },
    { label: '$(settings-gear) Open Settings', value: 'settings' }
  ];

  const selected = await vscode.window.showQuickPick(options, {
    placeHolder: 'What would you like to configure?'
  });

  if (!selected) {return;}

  switch (selected.value) {
    case 'gitlab':
      await configureGitLab();
      break;
    case 'llm':
      await configureLLM();
      break;
    case 'branch':
      await configureBranch();
      break;
    case 'commit':
      await configureCommit();
      break;
    case 'review':
      await configureReview();
      break;
    case 'context':
      await createBusinessContext();
      break;
    case 'test':
      await testConfiguration();
      break;
    case 'settings':
      vscode.commands.executeCommand('workbench.action.openSettings', 'gitlabAI');
      break;
  }
}

async function configureGitLab(): Promise<void> {
  const config = ConfigManager.getConfig();

  // GitLab URL
  const gitlabUrl = await vscode.window.showInputBox({
    prompt: 'Enter your self-hosted GitLab URL',
    value: config.gitlabUrl,
    placeHolder: 'https://gitlab.yourcompany.com',
    validateInput: (value) => {
      if (!value) {return null;} // Allow empty to skip
      try {
        new URL(value);
        return null;
      } catch {
        return 'Please enter a valid URL';
      }
    }
  });

  if (gitlabUrl !== undefined) {
    await ConfigManager.updateConfig('gitlabUrl', gitlabUrl);
  }

  // GitLab Token
  const gitlabToken = await vscode.window.showInputBox({
    prompt: 'Enter your GitLab Personal Access Token (with api scope)',
    password: true,
    placeHolder: 'Leave empty to keep current token'
  });

  if (gitlabToken) {
    await ConfigManager.updateConfig('gitlabToken', gitlabToken);
  }

  // Default target branch
  const targetBranch = await vscode.window.showInputBox({
    prompt: 'Default target branch for MRs',
    value: config.defaultTargetBranch,
    placeHolder: 'main'
  });

  if (targetBranch !== undefined) {
    await ConfigManager.updateConfig('defaultTargetBranch', targetBranch);
  }

  vscode.window.showInformationMessage('GitLab configuration updated!');
}

async function configureLLM(): Promise<void> {
  const config = ConfigManager.getConfig();

  // LLM Provider
  const provider = await vscode.window.showQuickPick([
    { label: 'OpenAI', value: 'openai', description: 'GPT-4, GPT-3.5, etc.' },
    { label: 'Anthropic', value: 'anthropic', description: 'Claude models' },
    { label: 'Ollama', value: 'ollama', description: 'Local models via Ollama' },
    { label: 'Custom', value: 'custom', description: 'Custom OpenAI-compatible API' }
  ], {
    placeHolder: 'Select LLM Provider',
    title: 'LLM Provider'
  });

  if (!provider) {return;}

  await ConfigManager.updateConfig('llmProvider', provider.value as any);

  // API URL (for custom, ollama)
  if (['custom', 'ollama'].includes(provider.value)) {
    const defaultUrl = provider.value === 'ollama' ? 'http://localhost:11434' : '';
    const apiUrl = await vscode.window.showInputBox({
      prompt: `Enter ${provider.label} API URL`,
      value: config.llmApiUrl || defaultUrl,
      placeHolder: defaultUrl || 'https://your-api.com/v1'
    });

    if (apiUrl !== undefined) {
      await ConfigManager.updateConfig('llmApiUrl', apiUrl);
    }
  }

  // API Key (not needed for Ollama)
  if (provider.value !== 'ollama') {
    const apiKey = await vscode.window.showInputBox({
      prompt: `Enter ${provider.label} API Key`,
      password: true,
      placeHolder: 'Leave empty to keep current key'
    });

    if (apiKey) {
      await ConfigManager.updateConfig('llmApiKey', apiKey);
    }
  }

  // Model
  const modelSuggestions: Record<string, string[]> = {
    openai: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    anthropic: ['claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'],
    ollama: ['llama2', 'codellama', 'mistral', 'mixtral'],
    custom: ['gpt-4', 'custom-model']
  };

  const models = modelSuggestions[provider.value] || ['gpt-4'];
  const modelOptions = models.map(m => ({ label: m, value: m }));
  modelOptions.push({ label: 'Custom...', value: '__custom__' });

  const selectedModel = await vscode.window.showQuickPick(modelOptions, {
    placeHolder: 'Select model',
    title: 'LLM Model'
  });

  if (selectedModel) {
    let model = selectedModel.value;
    if (model === '__custom__') {
      const customModel = await vscode.window.showInputBox({
        prompt: 'Enter custom model name',
        value: config.llmModel
      });
      if (customModel) {
        model = customModel;
      } else {
        return;
      }
    }
    await ConfigManager.updateConfig('llmModel', model);
  }

  vscode.window.showInformationMessage('LLM configuration updated!');
}

async function configureBranch(): Promise<void> {
  const config = ConfigManager.getConfig();

  // Branch naming convention
  const convention = await vscode.window.showInputBox({
    prompt: 'Branch naming convention template',
    value: config.branchNamingConvention,
    placeHolder: '{type}/{ticket}-{description}',
    validateInput: (value) => {
      if (!value?.includes('{type}') && !value?.includes('{description}')) {
        return 'Template should include at least {type} or {description}';
      }
      return null;
    }
  });

  if (convention !== undefined) {
    await ConfigManager.updateConfig('branchNamingConvention', convention);
  }

  // Branch types
  const currentTypes = config.branchTypes.join(', ');
  const types = await vscode.window.showInputBox({
    prompt: 'Allowed branch types (comma-separated)',
    value: currentTypes,
    placeHolder: 'feature, bugfix, hotfix, release, chore'
  });

  if (types !== undefined) {
    const typeArray = types.split(',').map(t => t.trim()).filter(t => t);
    await ConfigManager.updateConfig('branchTypes', typeArray);
  }

  vscode.window.showInformationMessage('Branch naming configuration updated!');
}

async function configureCommit(): Promise<void> {
  const config = ConfigManager.getConfig();

  // Commit convention
  const convention = await vscode.window.showQuickPick([
    { label: 'Conventional Commits', value: 'conventional', description: 'type(scope): subject' },
    { label: 'Angular', value: 'angular', description: 'Angular commit format' },
    { label: 'Gitmoji', value: 'gitmoji', description: 'With emoji prefixes' },
    { label: 'Custom', value: 'custom', description: 'Your own template' }
  ], {
    placeHolder: 'Select commit message convention'
  });

  if (!convention) {return;}

  await ConfigManager.updateConfig('commitMessageConvention', convention.value as any);

  // Custom template if selected
  if (convention.value === 'custom') {
    const template = await vscode.window.showInputBox({
      prompt: 'Enter custom commit template',
      value: config.customCommitTemplate,
      placeHolder: '{type}({scope}): {subject}'
    });

    if (template !== undefined) {
      await ConfigManager.updateConfig('customCommitTemplate', template);
    }
  }

  vscode.window.showInformationMessage('Commit message configuration updated!');
}

async function configureReview(): Promise<void> {
  const config = ConfigManager.getConfig();

  // Review mode
  const mode = await vscode.window.showQuickPick([
    { label: 'Syntax Only', value: 'syntax', description: 'Style, formatting, naming' },
    { label: 'Logic', value: 'logic', description: 'Bugs, edge cases, error handling' },
    { label: 'Business', value: 'business', description: 'With business context' },
    { label: 'Comprehensive', value: 'comprehensive', description: 'All aspects' }
  ], {
    placeHolder: 'Select review mode'
  });

  if (mode) {
    await ConfigManager.updateConfig('reviewMode', mode.value as any);
  }

  // Business context file
  const contextFile = await vscode.window.showInputBox({
    prompt: 'Path to business context file',
    value: config.businessContextFile,
    placeHolder: '.gitlab-ai-context.md'
  });

  if (contextFile !== undefined) {
    await ConfigManager.updateConfig('businessContextFile', contextFile);
  }

  // Draft MR option
  const draftMR = await vscode.window.showQuickPick([
    { label: 'Yes', value: true, description: 'Create MRs as draft' },
    { label: 'No', value: false, description: 'Create MRs as ready' }
  ], {
    placeHolder: 'Create MRs as draft by default?'
  });

  if (draftMR) {
    await ConfigManager.updateConfig('enableDraftMR', draftMR.value);
  }

  vscode.window.showInformationMessage('Review configuration updated!');
}

async function createBusinessContext(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('No workspace folder open');
    return;
  }

  const loader = new BusinessContextLoader(workspaceFolders[0].uri.fsPath);
  await loader.createSampleContextFile();
  
  vscode.window.showInformationMessage('Business context file created! Edit it to add your project context.');
}

async function testConfiguration(): Promise<void> {
  const validation = ConfigManager.validateConfig();

  if (!validation.valid) {
    vscode.window.showErrorMessage(
      `Configuration errors:\n${validation.errors.join('\n')}`,
      'Configure'
    ).then(action => {
      if (action === 'Configure') {
        configureCommand();
      }
    });
    return;
  }

  const config = ConfigManager.getConfig();

  // Test GitLab connection
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Testing configuration...',
    cancellable: false
  }, async (progress) => {
    const results: string[] = [];

    // Test GitLab
    progress.report({ message: 'Testing GitLab connection...' });
    try {
      const gitlabService = new GitLabService(config);
      const user = await gitlabService.getCurrentUser();
      results.push(`✅ GitLab: Connected as ${user.username}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      results.push(`❌ GitLab: ${message}`);
    }

    // Test LLM (simple test)
    progress.report({ message: 'Testing LLM connection...' });
    try {
      const { LLMService } = await import('../services/llmService');
      const llmService = new LLMService(config);
      const response = await llmService.chat([
        { role: 'user', content: 'Reply with just "OK" if you can read this.' }
      ], { maxTokens: 10 });
      
      if (response.content.toLowerCase().includes('ok')) {
        results.push(`✅ LLM (${config.llmProvider}/${config.llmModel}): Connected`);
      } else {
        results.push('⚠️ LLM: Unexpected response');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      results.push(`❌ LLM: ${message}`);
    }

    // Show results
    const allPassed = results.every(r => r.startsWith('✅'));
    
    if (allPassed) {
      vscode.window.showInformationMessage('All configuration tests passed!\n\n' + results.join('\n'));
    } else {
      vscode.window.showWarningMessage(
        'Some tests failed:\n\n' + results.join('\n'),
        'Configure'
      ).then(action => {
        if (action === 'Configure') {
          configureCommand();
        }
      });
    }
  });
}