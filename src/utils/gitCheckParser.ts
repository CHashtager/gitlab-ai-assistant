import * as fs from 'fs/promises';
import * as path from 'path';

export interface GitCheckRules {
  branchNamePattern?: string;
  branchNameRegex?: RegExp;
  commitMessagePattern?: string;
  commitMessageRegex?: RegExp;
  allowedBranchTypes?: string[];
  requiresTicketNumber?: boolean;
  commitRequiresTicketNumber?: boolean;
  hasGitCheck: boolean;
}

// Protected branches that should never be pushed to directly
export const PROTECTED_BRANCHES = ['main', 'master', 'dev', 'develop', 'development'];

export function isProtectedBranch(branchName: string): boolean {
  return PROTECTED_BRANCHES.includes(branchName.toLowerCase());
}

/**
 * Parse .gitlab-ci.yml to extract git-check rules for branch naming and commit messages
 */
export async function parseGitCheckRules(workspaceRoot: string): Promise<GitCheckRules> {
  const rules: GitCheckRules = {
    hasGitCheck: false
  };

  try {
    const ciFilePath = path.join(workspaceRoot, '.gitlab-ci.yml');
    const content = await fs.readFile(ciFilePath, 'utf-8');

    // Check if git-check stage exists
    if (!content.includes('git-check') && !content.includes('git_check')) {
      return rules;
    }

    rules.hasGitCheck = true;

    // Extract branch name check patterns
    const branchPatterns = extractBranchNamePatterns(content);
    if (branchPatterns.pattern) {
      rules.branchNamePattern = branchPatterns.pattern;
      rules.branchNameRegex = branchPatterns.regex;
      rules.allowedBranchTypes = branchPatterns.types;
      // Check if pattern requires ticket number
      rules.requiresTicketNumber = /\[A-Z\].*\[0-9\]/.test(branchPatterns.pattern) || 
                                    branchPatterns.pattern.includes('ticket');
    }

    // Extract commit message check patterns
    const commitPatterns = extractCommitMessagePatterns(content);
    if (commitPatterns.pattern) {
      rules.commitMessagePattern = commitPatterns.pattern;
      rules.commitMessageRegex = commitPatterns.regex;
      // Check if commit message pattern requires ticket number
      rules.commitRequiresTicketNumber = /\[A-Z\].*\[0-9\]/.test(commitPatterns.pattern) || 
                                          commitPatterns.pattern.includes('ticket');
    }

    return rules;
  } catch {
    // No .gitlab-ci.yml or unable to parse
    return rules;
  }
}

function extractBranchNamePatterns(content: string): { pattern?: string; regex?: RegExp; types?: string[] } {
  const result: { pattern?: string; regex?: RegExp; types?: string[] } = {};

  // Common patterns to look for in gitlab-ci.yml
  // Pattern 1: Regex pattern like /^(feature|bugfix|hotfix)\/[A-Z]+-[0-9]+-.*$/
  const regexMatch = content.match(/branch.*?(?:pattern|regex|match).*?['"]([^'"]+)['"]/i);
  if (regexMatch) {
    result.pattern = regexMatch[1];
    try {
      result.regex = new RegExp(regexMatch[1]);
    } catch {
      // Invalid regex
    }
  }

  // Pattern 2: Look for branch name check in script sections
  const scriptMatch = content.match(/branch.*?=~.*?\/([^/]+)\//i);
  if (scriptMatch && !result.pattern) {
    result.pattern = scriptMatch[1];
    try {
      result.regex = new RegExp(scriptMatch[1]);
    } catch {
      // Invalid regex
    }
  }

  // Pattern 3: Look for allowed branch types
  const typesMatch = content.match(/(?:branch[_-]?types?|allowed[_-]?branches?).*?[['"]([\\w,\\s|]+)['"]/i);
  if (typesMatch) {
    result.types = typesMatch[1].split(/[,|\s]+/).filter(t => t.trim()).map(t => t.trim());
  }

  // Pattern 4: Common conventional pattern
  const conventionalMatch = content.match(/(feature|bugfix|hotfix|fix|feat|chore|docs|refactor)/gi);
  if (conventionalMatch && !result.types) {
    result.types = [...new Set(conventionalMatch.map(t => t.toLowerCase()))];
  }

  // Default patterns if nothing found but git-check exists
  if (!result.pattern && !result.types) {
    // Check for common patterns in the content
    if (content.includes('conventional') || content.includes('feat') || content.includes('fix')) {
      result.types = ['feature', 'feat', 'fix', 'bugfix', 'hotfix', 'chore', 'docs', 'refactor', 'test'];
      result.pattern = '^(feature|feat|fix|bugfix|hotfix|chore|docs|refactor|test)/[a-z0-9-]+$';
      result.regex = new RegExp(result.pattern, 'i');
    }
  }

  return result;
}

function extractCommitMessagePatterns(content: string): { pattern?: string; regex?: RegExp } {
  const result: { pattern?: string; regex?: RegExp } = {};

  // Pattern 1: grep -qE with regex pattern (common in gitlab-ci scripts)
  const grepMatch = content.match(/grep\s+-[a-zA-Z]*E[a-zA-Z]*\s+["']([^"']+)["']/);
  if (grepMatch) {
    result.pattern = grepMatch[1];
    try {
      result.regex = new RegExp(grepMatch[1]);
    } catch {
      // Invalid regex - might have bash escaping
    }
  }

  // Pattern 2: Conventional commits pattern with explicit pattern/regex keyword
  if (!result.pattern) {
    const conventionalMatch = content.match(/commit.*?(?:pattern|regex|match).*?['"]([^'"]+)['"]/i);
    if (conventionalMatch) {
      result.pattern = conventionalMatch[1];
      try {
        result.regex = new RegExp(conventionalMatch[1]);
      } catch {
        // Invalid regex
      }
    }
  }

  // Pattern 3: Look for commit message check with =~ operator
  if (!result.pattern) {
    const scriptMatch = content.match(/commit.*?message.*?=~.*?\/([^/]+)\//i);
    if (scriptMatch) {
      result.pattern = scriptMatch[1];
      try {
        result.regex = new RegExp(scriptMatch[1]);
      } catch {
        // Invalid regex
      }
    }
  }

  // Pattern 4: Check for conventional commits reference (fallback)
  if (!result.pattern) {
    if (content.includes('conventional-commit') || content.includes('conventionalcommit')) {
      result.pattern = '^(feat|fix|docs|style|refactor|perf|test|chore|ci|build)(\\([a-z-]+\\))?!?:\\s.+$';
      result.regex = new RegExp(result.pattern, 'i');
    }
  }

  // Note: Don't set a default pattern - let it be undefined if we can't find one
  // This prevents overriding valid patterns with incorrect defaults

  return result;
}

/**
 * Validate a branch name against the rules
 */
export function validateBranchName(branchName: string, rules: GitCheckRules): { valid: boolean; error?: string } {
  if (isProtectedBranch(branchName)) {
    return { valid: false, error: `Cannot use protected branch: ${branchName}` };
  }

  if (rules.branchNameRegex) {
    if (!rules.branchNameRegex.test(branchName)) {
      return { 
        valid: false, 
        error: `Branch name does not match pattern: ${rules.branchNamePattern}` 
      };
    }
  }

  return { valid: true };
}

/**
 * Validate a commit message against the rules
 */
export function validateCommitMessage(message: string, rules: GitCheckRules): { valid: boolean; error?: string } {
  if (rules.commitMessageRegex) {
    // Check first line (subject)
    const firstLine = message.split('\n')[0];
    if (!rules.commitMessageRegex.test(firstLine)) {
      return { 
        valid: false, 
        error: `Commit message does not match pattern: ${rules.commitMessagePattern}` 
      };
    }
  }

  return { valid: true };
}

/**
 * Get formatting instructions for the LLM based on rules
 */
export function getBranchNamingInstructions(rules: GitCheckRules, ticketNumber?: string): string {
  if (rules.hasGitCheck && rules.branchNamePattern) {
    // Parse the pattern to give clearer instructions
    const pattern = rules.branchNamePattern;
    
    // Check if pattern requires a ticket number (e.g., [A-Z]+-[0-9]+)
    const requiresTicket = /\[A-Z\].*\[0-9\]/.test(pattern) || pattern.includes('ticket');
    
    // Extract allowed types from pattern
    const typesMatch = pattern.match(/\(([^)]+)\)/);
    const allowedTypes = typesMatch ? typesMatch[1].split('|').filter(t => !['dev', 'master', 'main'].includes(t)) : [];
    
    let instructions = `Generate a git branch name that MUST match this regex pattern: ${pattern}

`;
    
    if (allowedTypes.length > 0) {
      instructions += `Allowed branch types: ${allowedTypes.join(', ')}
`;
    }
    
    if (requiresTicket) {
      if (ticketNumber) {
        instructions += `Use this ticket number: ${ticketNumber}
`;
      } else {
        instructions += `The pattern requires a ticket number in format like ABC-123 or JIRA-456.
If no ticket number is apparent from the code, use a placeholder like TASK-001.
`;
      }
    }
    
    instructions += `
The branch name format should be: {type}/{TICKET-NUMBER}-{short-description}
- type: one of the allowed types (feature, bugfix, hotfix, chore, refactor)
- TICKET-NUMBER: uppercase letters, dash, numbers (e.g., ABC-123, JIRA-456, TASK-001)
- short-description: lowercase letters, numbers, and hyphens only

Examples that match the pattern:
- feature/ABC-123-add-user-login
- bugfix/JIRA-456-fix-null-pointer
- hotfix/TASK-001-critical-fix

Return ONLY the branch name, nothing else. No quotes, no explanation.`;
    
    return instructions;
  }

  // Default conventional naming
  return `Follow conventional branch naming:
- Format: {type}/{ticket-or-description}
- Types: feature, bugfix, hotfix, chore, docs, refactor
- Use lowercase letters, numbers, and hyphens only
- Keep it concise but descriptive
- If a ticket number is mentioned, include it
- Maximum 50 characters

Examples:
- feature/ABC-123-add-user-auth
- bugfix/fix-login-redirect
- chore/update-dependencies

Return ONLY the branch name, nothing else.`;
}

/**
 * Get commit message instructions for the LLM based on rules
 */
export function getCommitMessageInstructions(rules: GitCheckRules, ticketNumber?: string): string {
  if (rules.hasGitCheck && rules.commitMessagePattern) {
    const pattern = rules.commitMessagePattern;
    
    // Check if pattern requires a ticket number in uppercase (e.g., [A-Z]+-[0-9]+)
    const requiresUppercaseTicket = /\[A-Z\]\+-\[0-9\]\+/.test(pattern);
    // Check if the ticket is required in scope/parentheses
    const requiresTicketInScope = pattern.includes('([A-Z]+-[0-9]+)') || pattern.includes('\\([A-Z]+-[0-9]+\\)');
    
    let instructions = `Generate a git commit message that MUST match this regex pattern: ${pattern}

`;

    if (requiresTicketInScope && ticketNumber) {
      instructions += `CRITICAL: The ticket number ${ticketNumber.toUpperCase()} must be in the scope (parentheses).
Format: <type>(${ticketNumber.toUpperCase()}): <description>

Example: fix(${ticketNumber.toUpperCase()}): update error handling
Example: feat(${ticketNumber.toUpperCase()}): add new validation logic
`;
    } else if (requiresUppercaseTicket && ticketNumber) {
      instructions += `Include this ticket number (UPPERCASE): ${ticketNumber.toUpperCase()}
`;
    }

    instructions += `
The format based on the pattern is: <type>(<TICKET-ID>): <short description>
- type: one of feat, fix, chore, docs, style, refactor, test, ci, build (lowercase)
- TICKET-ID: uppercase letters, dash, numbers (e.g., ABC-123, JIRA-456) - THIS MUST BE UPPERCASE
- short description: brief description of the change

Examples that match the pattern:
- feat(ABC-123): add user authentication
- fix(JIRA-456): resolve null pointer exception  
- chore(TASK-789): update dependencies

Return ONLY the commit message, nothing else. No quotes, no markdown, no explanation.`;

    return instructions;
  }

  // Default conventional commits
  let defaultInstructions = `Follow Conventional Commits specification:
Format: <type>(<optional-scope>): <subject>

<optional body>

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
- Lowercase type and scope
`;

  if (ticketNumber) {
    defaultInstructions += `
Include ticket number ${ticketNumber} in the commit message.
`;
  }

  defaultInstructions += `
Return ONLY the commit message, nothing else.`;

  return defaultInstructions;
}
