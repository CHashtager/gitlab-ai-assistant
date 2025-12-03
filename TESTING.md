# Quick Start Testing Guide

This guide will help you quickly test the GitLab AI Assistant extension.

## Prerequisites

1. ✅ Dependencies installed (`npm install` completed)
2. ✅ TypeScript compiled (`npm run compile` completed)
3. ✅ No lint errors

## Quick Test Setup

### 1. Install the Extension

```bash
# Package the extension
npm run package

# This creates a .vsix file
# Install it via VS Code: Extensions → ... → Install from VSIX
```

### 2. Minimal Configuration

Press `Cmd+Shift+P` and run: **GitLab AI: Configure Settings**

Or manually set in VS Code settings:

```json
{
  "gitlabAI.gitlabUrl": "https://gitlab.com",
  "gitlabAI.gitlabToken": "YOUR_GITLAB_TOKEN",
  "gitlabAI.llmProvider": "openai",
  "gitlabAI.llmApiKey": "YOUR_OPENAI_KEY",
  "gitlabAI.llmModel": "gpt-4"
}
```

### 3. Test in Development Mode

Instead of packaging, you can test directly:

1. Open this folder in VS Code
2. Press `F5` to start debugging
3. A new VS Code window will open with the extension loaded
4. Open a Git repository in that window
5. Test the commands

## Quick Tests

### Test 1: Configuration Test
```
Cmd+Shift+P → GitLab AI: Configure Settings → Test Configuration
```
Expected: ✅ GitLab and LLM connections verified

### Test 2: Create Branch
```
Cmd+Shift+P → GitLab AI: Create New Branch
Description: "add user login feature"
Type: feature
```
Expected: Branch `feature/XXX-add-user-login-feature` created

### Test 3: Commit with AI
1. Make a small code change
2. `Cmd+Shift+P → GitLab AI: Commit Changes with AI Message`
3. Review the generated commit message
Expected: Conventional commit message generated

### Test 4: Review Code
1. Make some changes (don't commit)
2. `Cmd+Shift+P → GitLab AI: Review Current Changes`
3. Check Problems panel
Expected: AI review comments appear

## Testing with Ollama (No API Key Needed)

If you don't want to use paid APIs:

1. Install Ollama: https://ollama.ai
2. Start Ollama and pull a model:
   ```bash
   ollama serve
   ollama pull llama2
   ```
3. Configure:
   ```json
   {
     "gitlabAI.llmProvider": "ollama",
     "gitlabAI.llmApiUrl": "http://localhost:11434",
     "gitlabAI.llmModel": "llama2"
   }
   ```

## Common Issues

### "Cannot find module" errors
```bash
npm install
npm run compile
```

### "GitLab API Error"
- Check your GitLab token has `api` scope
- Verify GitLab URL includes `https://`

### "LLM API Error"
- Verify API key is correct
- Check you have credits/quota
- For Ollama, ensure `ollama serve` is running

## Development Workflow

```bash
# 1. Make changes to src/
vim src/commands/createBranch.ts

# 2. Compile
npm run compile

# 3. Test in debug mode
# Press F5 in VS Code

# 4. Check for errors
npm run lint
```

## Next Steps

Once basic testing works:
1. Test the full workflow command
2. Create a business context file
3. Test MR creation (requires GitLab repo)
4. Test code review with business context

## Packaging for Distribution

```bash
# Create installable .vsix
npm run package

# Share the .vsix file or publish to marketplace
```

## Debugging Tips

- Check Output panel: View → Output → Select "GitLab AI Assistant"
- Use Developer Tools: Help → Toggle Developer Tools
- Enable verbose logging in extension settings
- Test with a simple repository first

## Success Criteria

✅ Extension activates without errors
✅ Configuration test passes  
✅ Can create a branch with AI naming
✅ Can generate commit messages
✅ Code review generates suggestions
✅ No TypeScript compilation errors
✅ No ESLint errors (warnings OK)

---

For detailed documentation, see [README.md](./README.md)
