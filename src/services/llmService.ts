import axios, { AxiosInstance } from 'axios';
import { GitLabAIConfig, LLMMessage, LLMResponse } from '../types';

export class LLMService {
  private config: GitLabAIConfig;
  private client: AxiosInstance;

  constructor(config: GitLabAIConfig) {
    this.config = config;
    this.client = this.createClient();
  }

  private createClient(): AxiosInstance {
    const baseURL = this.getBaseURL();
    const headers = this.getHeaders();

    return axios.create({
      baseURL,
      headers,
      timeout: 120000 // 2 minutes for long responses
    });
  }

  private getBaseURL(): string {
    switch (this.config.llmProvider) {
      case 'openai':
        return this.config.llmApiUrl || 'https://api.openai.com/v1';
      case 'anthropic':
        return this.config.llmApiUrl || 'https://api.anthropic.com/v1';
      case 'ollama':
        return this.config.llmApiUrl || 'http://localhost:11434';
      case 'custom':
        return this.config.llmApiUrl;
      default:
        return 'https://api.openai.com/v1';
    }
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    switch (this.config.llmProvider) {
      case 'openai':
      case 'custom':
        headers['Authorization'] = `${this.config.llmApiKey}`;
        break;
      case 'anthropic':
        headers['x-api-key'] = this.config.llmApiKey;
        headers['anthropic-version'] = '2023-06-01';
        break;
      case 'ollama':
        // Ollama typically doesn't need auth
        break;
    }

    return headers;
  }

  async chat(messages: LLMMessage[], options: {
    maxTokens?: number;
    temperature?: number;
    systemPrompt?: string;
  } = {}): Promise<LLMResponse> {
    const { maxTokens = 4096, temperature = 0.3, systemPrompt } = options;

    // Add system prompt if provided
    const allMessages = systemPrompt
      ? [{ role: 'system' as const, content: systemPrompt }, ...messages]
      : messages;

    switch (this.config.llmProvider) {
      case 'openai':
      case 'custom':
        return this.chatOpenAI(allMessages, maxTokens, temperature);
      case 'anthropic':
        return this.chatAnthropic(allMessages, maxTokens, temperature);
      case 'ollama':
        return this.chatOllama(allMessages, maxTokens, temperature);
      default:
        return this.chatOpenAI(allMessages, maxTokens, temperature);
    }
  }

  private async chatOpenAI(messages: LLMMessage[], maxTokens: number, temperature: number): Promise<LLMResponse> {
    const endpoint = '/chat/completions';

    const response = await this.client.post(endpoint, {
      model: this.config.llmModel,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens: maxTokens,
      temperature
    });

    return {
      content: response.data.choices[0].message.content,
      usage: response.data.usage
    };
  }

  private async chatAnthropic(messages: LLMMessage[], maxTokens: number, temperature: number): Promise<LLMResponse> {
    // Anthropic requires system message to be separate
    const systemMessage = messages.find(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system');

    const response = await this.client.post('/messages', {
      model: this.config.llmModel,
      max_tokens: maxTokens,
      temperature,
      system: systemMessage?.content,
      messages: chatMessages.map(m => ({ role: m.role, content: m.content }))
    });

    return {
      content: response.data.content[0].text,
      usage: {
        prompt_tokens: response.data.usage.input_tokens,
        completion_tokens: response.data.usage.output_tokens,
        total_tokens: response.data.usage.input_tokens + response.data.usage.output_tokens
      }
    };
  }

  private async chatOllama(messages: LLMMessage[], maxTokens: number, temperature: number): Promise<LLMResponse> {
    const response = await this.client.post('/api/chat', {
      model: this.config.llmModel,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: false,
      options: {
        num_predict: maxTokens,
        temperature
      }
    });

    return {
      content: response.data.message.content,
      usage: {
        prompt_tokens: response.data.prompt_eval_count || 0,
        completion_tokens: response.data.eval_count || 0,
        total_tokens: (response.data.prompt_eval_count || 0) + (response.data.eval_count || 0)
      }
    };
  }

  async generateCommitMessage(diff: string, convention: string, customTemplate?: string): Promise<string> {
    const systemPrompt = this.getCommitMessageSystemPrompt(convention, customTemplate);
    
    const response = await this.chat([
      { role: 'user', content: `Generate a commit message for the following changes:\n\n${diff}` }
    ], { systemPrompt, maxTokens: 500, temperature: 0.3 });

    return response.content.trim();
  }

  /**
   * Generate commit message with git-check rules from .gitlab-ci.yml
   */
  async generateCommitMessageWithRules(diff: string, rulesInstructions: string, ticketNumber?: string): Promise<string> {
    const systemPrompt = `You are going to generate git commit messages.

${rulesInstructions}

IMPORTANT: Return ONLY the commit message. No explanation, no quotes. Just the commit message.`;
    
    const response = await this.chat([
      { role: 'user', content: `Generate a commit message for the following changes:\n\n${diff}` }
    ], { systemPrompt, maxTokens: 500, temperature: 0.3 });

    // Clean up the response - handle LLM thinking tags (Qwen, etc.)
    let message = response.content.trim();
    
    // Remove <think>...</think> blocks (Qwen3 reasoning mode)
    message = message.replace(/<think>[\s\S]*?<\/think>/gi, '');
    
    // Remove any other XML-like tags
    message = message.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/gi, '');
    
    // Remove markdown code blocks
    message = message.replace(/```[\s\S]*?```/g, '');
    message = message.replace(/`([^`]+)`/g, '$1');
    
    // Remove surrounding quotes
    message = message.replace(/^["']|["']$/g, '');
    
    message = message.trim();
    
    // Post-process: ensure ticket number is in correct format if provided
    if (ticketNumber) {
      const upperTicket = ticketNumber.toUpperCase();
      // Check if message has the format type(scope): description
      const conventionalMatch = message.match(/^(feat|fix|chore|docs|style|refactor|test|ci|build|perf)(\([^)]*\))?:\s*(.+)$/i);
      if (conventionalMatch) {
        const type = conventionalMatch[1].toLowerCase();
        const existingScope = conventionalMatch[2];
        const description = conventionalMatch[3];
        
        // Check if scope contains a ticket pattern but with wrong case
        if (existingScope) {
          const scopeContent = existingScope.slice(1, -1); // Remove parentheses
          if (/^[a-z]+-[0-9]+$/i.test(scopeContent)) {
            // It's a ticket number - ensure it's uppercase
            message = `${type}(${upperTicket}): ${description}`;
          } else if (!scopeContent.match(/^[A-Z]+-[0-9]+$/)) {
            // Scope is not a ticket - replace with ticket
            message = `${type}(${upperTicket}): ${description}`;
          }
        } else {
          // No scope - add ticket as scope
          message = `${type}(${upperTicket}): ${description}`;
        }
      } else {
        // Not conventional format - try to make it so
        const simpleMatch = message.match(/^(feat|fix|chore|docs|style|refactor|test|ci|build|perf):\s*(.+)$/i);
        if (simpleMatch) {
          message = `${simpleMatch[1].toLowerCase()}(${upperTicket}): ${simpleMatch[2]}`;
        }
      }
    }
    
    return message;
  }

  async generateBranchName(description: string, type: string, convention: string): Promise<string> {
    const systemPrompt = `You are going to generate git branch names.
Follow this naming convention: ${convention}
Available placeholders: {type}, {ticket}, {description}, {username}, {date}

Rules:
- Use lowercase letters, numbers, and hyphens only
- Keep it concise but descriptive
- If a ticket number is mentioned in the description, extract it
- Remove any special characters
- Maximum 50 characters for the description part

Return ONLY the branch name, nothing else.`;

    const response = await this.chat([
      { role: 'user', content: `Generate a branch name for:\nType: ${type}\nDescription: ${description}` }
    ], { systemPrompt, maxTokens: 100, temperature: 0.2 });

    return response.content.trim().replace(/[^a-z0-9\-/]/gi, '-').toLowerCase();
  }

  /**
   * Generate branch name with git-check rules from .gitlab-ci.yml
   */
  async generateBranchNameWithRules(diff: string, rulesInstructions: string): Promise<string> {
    const systemPrompt = `You are going to generate git branch names.

${rulesInstructions}

IMPORTANT: Return ONLY the branch name. No explanation, no quotes. Just the branch name.`;

    const response = await this.chat([
      { role: 'user', content: `Based on these code changes, generate an appropriate branch name:\n\n${diff.substring(0, 3000)}` }
    ], { systemPrompt, maxTokens: 100, temperature: 0.2 });

    // Clean up the response - handle LLM thinking tags (Qwen, etc.)
    let branchName = response.content.trim();
    
    // Remove <think>...</think> blocks (Qwen3 reasoning mode)
    branchName = branchName.replace(/<think>[\s\S]*?<\/think>/gi, '');
    
    // Remove any other XML-like tags
    branchName = branchName.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/gi, '');
    
    // Remove markdown code blocks
    branchName = branchName.replace(/```[\s\S]*?```/g, '');
    branchName = branchName.replace(/`([^`]+)`/g, '$1');
    
    // Remove quotes
    branchName = branchName.replace(/^["']|["']$/g, '');
    
    // Get only the last line if multiple lines (the actual answer)
    const lines = branchName.trim().split('\n').filter(l => l.trim());
    if (lines.length > 0) {
      // Find a line that looks like a branch name (contains /)
      const branchLine = lines.find(l => /^[a-z]+\/[A-Z]+-[0-9]+-[a-z0-9-]+$/i.test(l.trim()));
      branchName = branchLine || lines[lines.length - 1];
    }
    
    branchName = branchName.trim();
    branchName = branchName.replace(/\s+/g, '-'); // Replace spaces with hyphens
    
    // Keep the ticket number uppercase, but make the description lowercase
    // Pattern: type/TICKET-123-description
    const match = branchName.match(/^([a-z]+)\/([A-Z]+-[0-9]+)-(.+)$/i);
    if (match) {
      const type = match[1].toLowerCase();
      const ticket = match[2].toUpperCase();
      const description = match[3].toLowerCase().replace(/[^a-z0-9-]/g, '-');
      branchName = `${type}/${ticket}-${description}`;
    } else {
      // Fallback: try to preserve structure
      const parts = branchName.split('/');
      if (parts.length === 2) {
        const type = parts[0].toLowerCase();
        const rest = parts[1];
        // Try to find and preserve ticket number
        const ticketMatch = rest.match(/([A-Z]+-[0-9]+)/i);
        if (ticketMatch) {
          const ticket = ticketMatch[1].toUpperCase();
          const desc = rest.replace(ticketMatch[0], '').replace(/^-|-$/g, '').toLowerCase().replace(/[^a-z0-9-]/g, '-');
          branchName = `${type}/${ticket}-${desc}`;
        } else {
          branchName = `${type}/${rest.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
        }
      }
    }
    
    // Clean up any double hyphens
    branchName = branchName.replace(/-+/g, '-').replace(/-$/g, '');
    
    return branchName;
  }

  async generateMRDescription(
    branchName: string,
    commits: Array<{ message: string }>,
    diff: string,
    template?: string
  ): Promise<{ title: string; description: string }> {
    const systemPrompt = `You are going to generate merge request descriptions.
${template ? `Use this template as a guide:\n${template}\n` : ''}

Generate a clear, concise MR description that includes:
1. A brief summary of changes
2. List of main changes
3. Any breaking changes or important notes
4. Testing suggestions

Return a JSON object with "title" and "description" fields.`;

    const commitMessages = commits.map(c => `- ${c.message}`).join('\n');
    
    const response = await this.chat([
      {
        role: 'user',
        content: `Generate MR title and description for:
Branch: ${branchName}
Commits:
${commitMessages}

Diff summary (first 3000 chars):
${diff.substring(0, 3000)}`
      }
    ], { systemPrompt, maxTokens: 1000, temperature: 0.3 });

    try {
      // Try to parse as JSON
      const parsed = JSON.parse(response.content);
      return {
        title: parsed.title || branchName,
        description: parsed.description || ''
      };
    } catch {
      // If not JSON, try to extract title from first line
      const lines = response.content.split('\n');
      return {
        title: lines[0].replace(/^#*\s*/, '').trim() || branchName,
        description: lines.slice(1).join('\n').trim()
      };
    }
  }

  async reviewCode(
    diff: string,
    mode: string,
    businessContext?: string
  ): Promise<{
    summary: string;
    comments: Array<{
      file: string;
      line: number;
      severity: string;
      category: string;
      message: string;
      suggestion?: string;
    }>;
    score: number;
  }> {
    const systemPrompt = this.getCodeReviewSystemPrompt(mode, businessContext);

    const response = await this.chat([
      { role: 'user', content: `Review the following code changes:\n\n${diff}` }
    ], { systemPrompt, maxTokens: 4000, temperature: 0.2 });

    try {
      return JSON.parse(response.content);
    } catch {
      // Return a basic structure if parsing fails
      return {
        summary: response.content,
        comments: [],
        score: 70
      };
    }
  }

  private getCommitMessageSystemPrompt(convention: string, customTemplate?: string): string {
    const conventions: Record<string, string> = {
      conventional: `Generate commit messages following Conventional Commits specification:
<type>(<scope>): <subject>

<body>

<footer>

Types: feat, fix, docs, style, refactor, perf, test, chore, ci, build
- feat: new feature
- fix: bug fix
- docs: documentation changes
- style: formatting, missing semicolons, etc.
- refactor: code refactoring
- perf: performance improvements
- test: adding tests
- chore: maintenance tasks
- ci: CI/CD changes
- build: build system changes

Rules:
- Subject line max 72 characters
- Use imperative mood ("add" not "added")
- Don't end subject with period
- Body explains what and why, not how`,

      angular: `Generate commit messages following Angular commit convention:
<type>(<scope>): <short summary>

<body>

<footer>

Types: build, ci, docs, feat, fix, perf, refactor, test
Scope: component or module affected
Summary: imperative, present tense, lowercase, no period

Example: feat(auth): add OAuth2 login support`,

      gitmoji: `Generate commit messages with gitmoji:
<emoji> <type>(<scope>): <subject>

Common emojis:
✨ :sparkles: - New feature
🐛 :bug: - Bug fix
📝 :memo: - Documentation
💄 :lipstick: - UI/style
♻️ :recycle: - Refactor
⚡ :zap: - Performance
✅ :white_check_mark: - Tests
🔧 :wrench: - Config
🚀 :rocket: - Deploy
🔒 :lock: - Security

Example: ✨ feat(auth): add social login`,

      custom: `Generate commit messages following this custom template:
${customTemplate}

Fill in the placeholders based on the changes.`
    };

    return conventions[convention] || conventions.conventional;
  }

  private getCodeReviewSystemPrompt(mode: string, businessContext?: string): string {
    const basePrompt = `You are an expert code reviewer. Analyze the provided code changes and provide constructive, actionable and detailed feedback.

Return your review as a JSON object with this structure:
{
  "summary": "Brief overall summary of the changes and their quality",
  "comments": [
    {
      "file": "path/to/file.ts",
      "line": 42,
      "severity": "error|warning|info|suggestion",
      "category": "syntax|logic|performance|security|style|business",
      "message": "Description of the issue",
      "suggestion": "Optional suggested fix or improvement"
    }
  ],
  "score": 85
}

Score guidelines:
- 90-100: Excellent, ready to merge
- 70-89: Good, minor issues
- 50-69: Needs work, several issues
- Below 50: Significant problems`;

    const modeInstructions: Record<string, string> = {
      syntax: `Focus ONLY on:
- Syntax errors and typos
- Code style and formatting
- Naming conventions
- Import organization`,

      logic: `Focus ONLY on:
- Logical errors and bugs
- Edge cases and error handling
- Null/undefined checks
- Algorithm correctness
- Race conditions`,

      business: `Focus on:
- Business logic correctness
- Domain model accuracy
- Requirements compliance
- Data validation
${businessContext ? `\nBusiness Context:\n${businessContext}` : ''}`,

      comprehensive: `Review ALL aspects:
- Syntax and style
- Logic and correctness
- Performance implications / optimizations
- Security vulnerabilities
- Best practices
- Code quality
- Maintainability and readability
- Test coverage suggestions
${businessContext ? `\nBusiness Context:\n${businessContext}` : ''}`
    };

    return `${basePrompt}\n\n${modeInstructions[mode] || modeInstructions.comprehensive}`;
  }

  /**
   * AI-powered target branch selection for merge requests
   */
  async selectTargetBranch(
    currentBranch: string,
    availableBranches: string[],
    defaultBranch: string,
    options?: {
      recentMRTargets?: string[];
      commitMessages?: string[];
      ticketNumber?: string;
    }
  ): Promise<{ targetBranch: string; confidence: 'high' | 'medium' | 'low'; reasoning: string }> {
    const systemPrompt = `You are a git workflow expert. Select the most appropriate target branch for a merge request.

## Selection Rules (in priority order):

1. **Branch naming convention analysis:**
   - \`feature/*\`, \`feat/*\` → target \`develop\` or \`dev\` if exists, else default branch
   - \`bugfix/*\`, \`fix/*\` → target \`develop\` for non-critical, \`main\`/\`master\` for hotfixes
   - \`hotfix/*\` → target \`main\` or \`master\` (production branch)
   - \`release/*\` → target \`main\` or \`master\`
   - \`chore/*\`, \`docs/*\` → target \`develop\` if exists, else default branch

2. **GitFlow detection:**
   - If both \`develop\`/\`dev\` AND \`main\`/\`master\` exist → likely GitFlow
   - Feature branches → \`develop\`/\`dev\`
   - Non-critical bugfixes branches → \`develop\`/\`dev\`
   - Hotfix branches → \`main\`/\`master\`

3. **Trunk-based detection:**
   - If only \`main\`/\`master\` exists (no \`develop\`/\`dev\`) → target default branch

4. **Historical patterns:**
   - Consider which branches have received similar MRs recently
   - Prefer branches that match the team's established workflow

5. **Fallback hierarchy:**
   - \`develop\` > \`development\` > \`dev\` > \`main\` > \`master\` > default branch

## Output Format
Return ONLY a valid JSON object with no additional text:
{"targetBranch": "<selected_branch>", "confidence": "high|medium|low", "reasoning": "<brief explanation>"}`;

    const userMessage = `Select the target branch for this merge request:

## Context
- **Source branch:** ${currentBranch}
- **Available branches:** ${availableBranches.join(', ')}
- **Project default branch:** ${defaultBranch}
${options?.recentMRTargets?.length ? `- **Recent MR target branches:** ${options.recentMRTargets.join(', ')}` : ''}
${options?.commitMessages?.length ? `- **Commit messages:** ${options.commitMessages.slice(0, 5).join('; ')}` : ''}
${options?.ticketNumber ? `- **Ticket/Issue:** ${options.ticketNumber}` : ''}`;

    try {
      const response = await this.chat(
        [{ role: 'user', content: userMessage }],
        { systemPrompt, maxTokens: 300, temperature: 0.1 }
      );

      // Clean up response and parse JSON
      let content = response.content.trim();
      
      // Remove thinking tags (Qwen, etc.)
      content = content.replace(/<think>[\s\S]*?<\/think>/gi, '');
      content = content.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/gi, '');
      
      // Extract JSON from potential markdown code blocks
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        content = jsonMatch[0];
      }

      const result = JSON.parse(content);
      
      // Validate the selected branch exists
      if (!availableBranches.includes(result.targetBranch)) {
        // Fallback to a valid branch
        return this.fallbackTargetBranch(availableBranches, defaultBranch);
      }

      return {
        targetBranch: result.targetBranch,
        confidence: result.confidence || 'medium',
        reasoning: result.reasoning || 'Selected based on branch naming conventions'
      };
    } catch (error) {
      // On any error, use fallback logic
      return this.fallbackTargetBranch(availableBranches, defaultBranch);
    }
  }

  /**
   * Fallback target branch selection when AI fails
   */
  private fallbackTargetBranch(
    availableBranches: string[],
    defaultBranch: string
  ): { targetBranch: string; confidence: 'high' | 'medium' | 'low'; reasoning: string } {
    const priorityOrder = ['develop', 'development', 'dev', 'main', 'master'];
    
    for (const branch of priorityOrder) {
      if (availableBranches.includes(branch)) {
        return {
          targetBranch: branch,
          confidence: 'medium',
          reasoning: `Fallback selection: ${branch} (priority-based)`
        };
      }
    }

    return {
      targetBranch: defaultBranch,
      confidence: 'low',
      reasoning: `Fallback to project default branch: ${defaultBranch}`
    };
  }
}