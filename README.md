# GitLab AI Assistant

AI-powered GitLab integration for VS Code that automates branch creation, commits, merge request management, and provides intelligent code review.

## Features

- 🌿 **AI Branch Creation**: Create branches with intelligent naming based on your description
- 💬 **Smart Commits**: Generate conventional commit messages from your changes
- 🚀 **Automated MR Creation**: Push and create merge requests with AI-generated descriptions
- 🔍 **Intelligent Code Review**: Get comprehensive code reviews using AI (syntax, logic, business context)
- ⚡ **Full Workflow Automation**: Complete workflow from branch creation to MR review
- 🎯 **Multiple LLM Support**: Works with OpenAI, Anthropic, Ollama, or custom endpoints
- 📋 **Customizable Conventions**: Configure branch naming, commit messages, and review modes

## Requirements

- VS Code 1.85.0 or higher
- GitLab account (self-hosted or GitLab.com)
- GitLab Personal Access Token with `api` scope
- LLM API access (OpenAI, Anthropic, Ollama, or custom)

## Installation

### From Source

1. Clone this repository:
   ```bash
   git clone https://github.com/CHashtager/gitlab-ai-assistant
   cd gitlab-ai-extension
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Compile the extension:
   ```bash
   npm run compile
   ```

4. Package the extension:
   ```bash
   npm run package
   ```

5. Install the generated `.vsix` file in VS Code:
   - Open VS Code
   - Go to Extensions view (Cmd+Shift+X)
   - Click "..." menu → "Install from VSIX..."
   - Select the generated `.vsix` file

## Configuration

### Quick Setup

1. After installation, run the command: **GitLab AI: Configure Settings**
2. Follow the interactive setup wizard to configure:
   - GitLab connection (URL and token)
   - LLM provider and credentials
   - Branch naming conventions
   - Commit message formats
   - Code review preferences

### Manual Configuration

Open VS Code settings (`Cmd+,`) and search for "GitLab AI" or edit `.vscode/settings.json`:

```json
{
  "gitlabAI.gitlabUrl": "https://gitlab.yourcompany.com",
  "gitlabAI.gitlabToken": "your-gitlab-token",
  "gitlabAI.llmProvider": "openai",
  "gitlabAI.llmApiKey": "your-api-key",
  "gitlabAI.llmModel": "gpt-4",
  "gitlabAI.branchNamingConvention": "{type}/{ticket}-{description}",
  "gitlabAI.commitMessageConvention": "conventional",
  "gitlabAI.reviewMode": "comprehensive",
  "gitlabAI.defaultTargetBranch": "main",
  "gitlabAI.enableDraftMR": true
}
```

### Configuration Options

#### GitLab Settings
- `gitlabAI.gitlabUrl`: Your GitLab instance URL (e.g., `https://gitlab.com` or self-hosted)
- `gitlabAI.gitlabToken`: Personal Access Token with `api` scope

#### LLM Settings
- `gitlabAI.llmProvider`: Choose from `openai`, `anthropic`, `ollama`, or `custom`
- `gitlabAI.llmApiUrl`: API URL for custom/Ollama endpoints
- `gitlabAI.llmApiKey`: API key for your LLM provider
- `gitlabAI.llmModel`: Model name (e.g., `gpt-4`, `claude-3-opus-20240229`, `llama2`)

#### Branch Settings
- `gitlabAI.branchNamingConvention`: Template with placeholders: `{type}`, `{ticket}`, `{description}`, `{username}`, `{date}`
- `gitlabAI.branchTypes`: Array of allowed branch types (e.g., `["feature", "bugfix", "hotfix"]`)

#### Commit Settings
- `gitlabAI.commitMessageConvention`: `conventional`, `angular`, `gitmoji`, or `custom`
- `gitlabAI.customCommitTemplate`: Custom template when using `custom` convention

#### Review Settings
- `gitlabAI.reviewMode`: `syntax`, `logic`, `business`, or `comprehensive`
- `gitlabAI.businessContextFile`: Path to business context file (default: `.gitlab-ai-context.md`)

#### Merge Request Settings
- `gitlabAI.defaultTargetBranch`: Default target branch for MRs (default: `main`)
- `gitlabAI.enableDraftMR`: Create MRs as draft by default
- `gitlabAI.autoAssignReviewers`: Auto-assign reviewers based on CODEOWNERS

## Usage

### Commands

Access commands via Command Palette (Cmd+Shift+P):

- **GitLab AI: Create New Branch** - Create a branch with AI-generated name
- **GitLab AI: Commit Changes with AI Message** - Generate and commit with AI message
- **GitLab AI: Push & Create Merge Request** - Push and create MR with AI description
- **GitLab AI: Review Current Changes** - AI review of local changes
- **GitLab AI: Review Merge Request** - Review an MR with inline comments
- **GitLab AI: Full Workflow** - Complete automation (Branch → Commit → Push → MR → Review)
- **GitLab AI: Configure Settings** - Interactive configuration wizard

### Keyboard Shortcuts

- `Cmd+Shift+G C` - Commit Changes
- `Cmd+Shift+G M` - Push & Create MR
- `Cmd+Shift+G F` - Full Workflow

### Status Bar

Click the "GitLab AI" icon in the status bar for quick access to all commands.

## Development

### Building from Source

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch mode for development
npm run watch

# Lint code
npm run lint

# Run tests
npm test

# Package extension
npm run package
```

### Project Structure

```
src/
  commands/        # Command implementations
  services/        # Core services (Git, GitLab, LLM)
  utils/          # Utilities and configuration
  types/          # TypeScript type definitions
  extension.ts    # Extension entry point
```

## Testing the Extension

### 1. Test Configuration

Run the configuration test:
```
Command Palette → GitLab AI: Configure Settings → Test Configuration
```

This will verify:
- GitLab connection and authentication
- LLM API connectivity
- Configuration validity

### 2. Test Individual Features

#### Create Branch
1. Open a Git repository
2. Run: **GitLab AI: Create New Branch**
3. Enter a description (e.g., "add user authentication")
4. Select branch type
5. Verify branch is created locally and on GitLab

#### Commit Changes
1. Make some code changes
2. Run: **GitLab AI: Commit Changes with AI Message**
3. Review the AI-generated commit message
4. Confirm to commit

#### Create Merge Request
1. Make changes and commit
2. Run: **GitLab AI: Push & Create Merge Request**
3. Verify MR is created on GitLab with AI-generated description

#### Code Review
1. Make some changes (don't commit yet)
2. Run: **GitLab AI: Review Current Changes**
3. Check the Problems panel for AI-generated review comments

### 3. Test Full Workflow

1. Run: **GitLab AI: Full Workflow**
2. Follow the prompts for each step
3. Verify the complete flow:
   - Branch created
   - Changes committed
   - Pushed to GitLab
   - MR created
   - Code review performed

### 4. Testing with Different LLM Providers

#### OpenAI
```json
{
  "gitlabAI.llmProvider": "openai",
  "gitlabAI.llmApiKey": "sk-...",
  "gitlabAI.llmModel": "gpt-4"
}
```

#### Anthropic
```json
{
  "gitlabAI.llmProvider": "anthropic",
  "gitlabAI.llmApiKey": "sk-ant-...",
  "gitlabAI.llmModel": "claude-3-opus-20240229"
}
```

#### Ollama (Local)
```bash
# Start Ollama
ollama serve

# Pull a model
ollama pull llama2
```

```json
{
  "gitlabAI.llmProvider": "ollama",
  "gitlabAI.llmApiUrl": "http://localhost:11434",
  "gitlabAI.llmModel": "llama2"
}
```

## Business Context

Create a `.gitlab-ai-context.md` file in your project root to provide business context for code reviews:

```markdown
# Project Context for AI Code Review

## Project Description
E-commerce platform for selling digital products with subscription support.

## Architecture
- Frontend: React + TypeScript
- Backend: Node.js + Express
- Database: PostgreSQL
- Payment: Stripe integration

## Coding Standards
- Use TypeScript strict mode
- Follow Airbnb style guide
- All API endpoints must have authentication
- Use async/await, not callbacks

## Domain Terms
- **Product**: Digital item for sale
- **Subscription**: Recurring payment plan
- **Credit**: In-app currency

## Security Requirements
- All user inputs must be validated
- No sensitive data in logs
- Rate limiting on all API endpoints

## Performance Requirements
- API response time < 200ms
- Support 1000 concurrent users
```

## Troubleshooting

### Extension Not Activating
- Check VS Code version (must be ≥1.85.0)
- Look for errors in: View → Output → GitLab AI Assistant

### GitLab Connection Issues
- Verify GitLab URL is correct (include https://)
- Ensure token has `api` scope
- Test connection: GitLab AI: Configure → Test Configuration

### LLM API Errors
- Check API key is valid
- Verify API URL for custom/Ollama providers
- Check model name is correct for your provider
- Review quota/rate limits

### Code Review Not Working
- Ensure you have uncommitted changes
- Check LLM provider is responding
- Verify `reviewMode` setting is valid

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## License

[LICENSE](./LICENSE)

## Support

For issues and feature requests, please file an issue on the repository.
