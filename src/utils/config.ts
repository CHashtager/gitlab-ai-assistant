import * as vscode from 'vscode';
import { GitLabAIConfig, LLMProvider, CommitConvention, ReviewMode } from '../types';

export class ConfigManager {
  private static readonly CONFIG_SECTION = 'gitlabAI';

  static getConfig(): GitLabAIConfig {
    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
    
    return {
      gitlabUrl: config.get<string>('gitlabUrl', ''),
      gitlabToken: config.get<string>('gitlabToken', ''),
      llmProvider: config.get<LLMProvider>('llmProvider', 'openai'),
      llmApiUrl: config.get<string>('llmApiUrl', ''),
      llmApiKey: config.get<string>('llmApiKey', ''),
      llmModel: config.get<string>('llmModel', 'gpt-4'),
      branchNamingConvention: config.get<string>('branchNamingConvention', '{type}/{ticket}-{description}'),
      branchTypes: config.get<string[]>('branchTypes', ['feature', 'bugfix', 'hotfix', 'release', 'chore', 'docs', 'refactor']),
      commitMessageConvention: config.get<CommitConvention>('commitMessageConvention', 'conventional'),
      customCommitTemplate: config.get<string>('customCommitTemplate', '{type}({scope}): {subject}'),
      reviewMode: config.get<ReviewMode>('reviewMode', 'comprehensive'),
      businessContextFile: config.get<string>('businessContextFile', '.gitlab-ai-context.md'),
      autoAssignReviewers: config.get<boolean>('autoAssignReviewers', false),
      defaultTargetBranch: config.get<string>('defaultTargetBranch', 'main'),
      mrTemplate: config.get<string>('mrTemplate', ''),
      enableDraftMR: config.get<boolean>('enableDraftMR', true),
    };
  }

  static async updateConfig<K extends keyof GitLabAIConfig>(
    key: K,
    value: GitLabAIConfig[K],
    global: boolean = true
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
    await config.update(key, value, global ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace);
  }

  static validateConfig(): { valid: boolean; errors: string[] } {
    const config = this.getConfig();
    const errors: string[] = [];

    if (!config.gitlabUrl) {
      errors.push('GitLab URL is not configured');
    } else if (!this.isValidUrl(config.gitlabUrl)) {
      errors.push('GitLab URL is not a valid URL');
    }

    if (!config.gitlabToken) {
      errors.push('GitLab token is not configured');
    }

    if (!config.llmApiKey && config.llmProvider !== 'ollama') {
      errors.push('LLM API key is not configured');
    }

    if (config.llmProvider === 'custom' && !config.llmApiUrl) {
      errors.push('Custom LLM API URL is required when using custom provider');
    }

    if (config.llmProvider === 'ollama' && !config.llmApiUrl) {
      errors.push('Ollama API URL is required (e.g., http://localhost:11434)');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  private static isValidUrl(string: string): boolean {
    try {
      new URL(string);
      return true;
    } catch {
      return false;
    }
  }

  static async promptForMissingConfig(): Promise<boolean> {
    const validation = this.validateConfig();
    
    if (validation.valid) {
      return true;
    }

    const config = this.getConfig();

    // Prompt for GitLab URL if missing
    if (!config.gitlabUrl) {
      const url = await vscode.window.showInputBox({
        prompt: 'Enter your self-hosted GitLab URL',
        placeHolder: 'https://gitlab.yourcompany.com',
        validateInput: (value) => {
          if (!value) {return 'GitLab URL is required';}
          try {
            new URL(value);
            return null;
          } catch {
            return 'Please enter a valid URL';
          }
        }
      });

      if (!url) {return false;}
      await this.updateConfig('gitlabUrl', url);
    }

    // Prompt for GitLab token if missing
    if (!config.gitlabToken) {
      const token = await vscode.window.showInputBox({
        prompt: 'Enter your GitLab Personal Access Token (with api scope)',
        password: true,
        validateInput: (value) => value ? null : 'Token is required'
      });

      if (!token) {return false;}
      await this.updateConfig('gitlabToken', token);
    }

    // Prompt for LLM API key if missing
    if (!config.llmApiKey && config.llmProvider !== 'ollama') {
      const apiKey = await vscode.window.showInputBox({
        prompt: `Enter your ${config.llmProvider} API key`,
        password: true,
        validateInput: (value) => value ? null : 'API key is required'
      });

      if (!apiKey) {return false;}
      await this.updateConfig('llmApiKey', apiKey);
    }

    // Prompt for LLM URL if using custom or ollama provider
    if ((config.llmProvider === 'custom' || config.llmProvider === 'ollama') && !config.llmApiUrl) {
      const defaultUrl = config.llmProvider === 'ollama' ? 'http://localhost:11434' : '';
      const url = await vscode.window.showInputBox({
        prompt: `Enter your ${config.llmProvider} API URL`,
        value: defaultUrl,
        validateInput: (value) => {
          if (!value) {return 'API URL is required';}
          try {
            new URL(value);
            return null;
          } catch {
            return 'Please enter a valid URL';
          }
        }
      });

      if (!url) {return false;}
      await this.updateConfig('llmApiUrl', url);
    }

    return this.validateConfig().valid;
  }
}

export function getWorkspaceFolder(): string | undefined {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return undefined;
  }
  return workspaceFolders[0].uri.fsPath;
}