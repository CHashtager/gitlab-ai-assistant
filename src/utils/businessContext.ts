import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { BusinessContext } from '../types';

export class BusinessContextLoader {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  async loadContext(contextFilePath: string): Promise<BusinessContext | null> {
    try {
      const fullPath = path.join(this.workspaceRoot, contextFilePath);
      const content = await fs.readFile(fullPath, 'utf-8');
      return this.parseContextFile(content);
    } catch (error) {
      // Context file doesn't exist or can't be read
      return null;
    }
  }

  private parseContextFile(content: string): BusinessContext {
    const context: BusinessContext = {};
    
    // Parse markdown-style sections
    const sections = this.parseSections(content);

    if (sections['project description'] || sections['description']) {
      context.projectDescription = sections['project description'] || sections['description'];
    }

    if (sections['architecture']) {
      context.architecture = sections['architecture'];
    }

    if (sections['coding standards'] || sections['style guide']) {
      context.codingStandards = sections['coding standards'] || sections['style guide'];
    }

    if (sections['domain terms'] || sections['glossary']) {
      context.domainTerms = this.parseDomainTerms(sections['domain terms'] || sections['glossary']);
    }

    if (sections['security requirements'] || sections['security']) {
      context.securityRequirements = this.parseList(sections['security requirements'] || sections['security']);
    }

    if (sections['performance requirements'] || sections['performance']) {
      context.performanceRequirements = this.parseList(sections['performance requirements'] || sections['performance']);
    }

    if (sections['custom rules'] || sections['rules']) {
      context.customRules = this.parseList(sections['custom rules'] || sections['rules']);
    }

    return context;
  }

  private parseSections(content: string): Record<string, string> {
    const sections: Record<string, string> = {};
    const lines = content.split('\n');
    let currentSection = '';
    let currentContent: string[] = [];

    for (const line of lines) {
      // Check for markdown headers (## or ###)
      const headerMatch = line.match(/^#{1,3}\s+(.+)$/);
      if (headerMatch) {
        // Save previous section
        if (currentSection) {
          sections[currentSection.toLowerCase()] = currentContent.join('\n').trim();
        }
        currentSection = headerMatch[1];
        currentContent = [];
      } else {
        currentContent.push(line);
      }
    }

    // Save last section
    if (currentSection) {
      sections[currentSection.toLowerCase()] = currentContent.join('\n').trim();
    }

    return sections;
  }

  private parseDomainTerms(content: string): Record<string, string> {
    const terms: Record<string, string> = {};
    const lines = content.split('\n');

    for (const line of lines) {
      // Parse "term: definition" or "- term: definition" format
      const match = line.match(/^[-*]?\s*\**(.+?)\**:\s*(.+)$/);
      if (match) {
        terms[match[1].trim()] = match[2].trim();
      }
    }

    return terms;
  }

  private parseList(content: string): string[] {
    const items: string[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      // Parse list items
      const match = line.match(/^[-*]\s+(.+)$/);
      if (match) {
        items.push(match[1].trim());
      } else if (line.trim()) {
        items.push(line.trim());
      }
    }

    return items.filter(item => item.length > 0);
  }

  formatForPrompt(): string {
    // This method creates a sample context file template
    return `# Project Context for AI Code Review

## Project Description
Describe your project, its purpose, and main functionality here.

## Architecture
Describe the overall architecture, main components, and how they interact.

## Coding Standards
- List your coding standards and conventions
- Naming conventions
- File organization rules

## Domain Terms
- **Term1**: Definition of term 1
- **Term2**: Definition of term 2

## Security Requirements
- List security requirements
- Authentication/authorization rules
- Data handling requirements

## Performance Requirements
- List performance requirements
- Response time expectations
- Resource usage limits

## Custom Rules
- Any custom rules for code review
- Project-specific patterns to follow
- Anti-patterns to avoid
`;
  }

  async createSampleContextFile(): Promise<void> {
    const contextPath = path.join(this.workspaceRoot, '.gitlab-ai-context.md');
    
    try {
      await fs.access(contextPath);
      // File exists, don't overwrite
      const overwrite = await vscode.window.showWarningMessage(
        'Context file already exists. Overwrite?',
        'Yes',
        'No'
      );
      if (overwrite !== 'Yes') {
        return;
      }
    } catch {
      // File doesn't exist, create it
    }

    await fs.writeFile(contextPath, this.formatForPrompt(), 'utf-8');
    
    // Open the file in editor
    const doc = await vscode.workspace.openTextDocument(contextPath);
    await vscode.window.showTextDocument(doc);
  }
}

export async function loadBusinessContext(workspaceRoot: string, contextFile: string): Promise<string | undefined> {
  const loader = new BusinessContextLoader(workspaceRoot);
  const context = await loader.loadContext(contextFile);
  
  if (!context) {
    return undefined;
  }

  // Format context for inclusion in prompts
  const parts: string[] = [];

  if (context.projectDescription) {
    parts.push(`Project: ${context.projectDescription}`);
  }

  if (context.architecture) {
    parts.push(`Architecture: ${context.architecture}`);
  }

  if (context.codingStandards) {
    parts.push(`Coding Standards: ${context.codingStandards}`);
  }

  if (context.domainTerms && Object.keys(context.domainTerms).length > 0) {
    const terms = Object.entries(context.domainTerms)
      .map(([term, def]) => `- ${term}: ${def}`)
      .join('\n');
    parts.push(`Domain Terms:\n${terms}`);
  }

  if (context.securityRequirements && context.securityRequirements.length > 0) {
    parts.push(`Security Requirements:\n- ${context.securityRequirements.join('\n- ')}`);
  }

  if (context.performanceRequirements && context.performanceRequirements.length > 0) {
    parts.push(`Performance Requirements:\n- ${context.performanceRequirements.join('\n- ')}`);
  }

  if (context.customRules && context.customRules.length > 0) {
    parts.push(`Custom Rules:\n- ${context.customRules.join('\n- ')}`);
  }

  return parts.join('\n\n');
}