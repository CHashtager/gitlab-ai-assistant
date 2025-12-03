import simpleGit, { SimpleGit, StatusResult, DiffResult } from 'simple-git';
import * as path from 'path';
import { FileDiff } from '../types';

export class GitService {
  private git: SimpleGit;
  private workingDir: string;

  constructor(workingDir: string) {
    this.workingDir = workingDir;
    this.git = simpleGit(workingDir);
  }

  async isGitRepository(): Promise<boolean> {
    try {
      await this.git.status();
      return true;
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<StatusResult> {
    return this.git.status();
  }

  async getCurrentBranch(): Promise<string> {
    const status = await this.git.status();
    return status.current || 'HEAD';
  }

  async getBranches(): Promise<string[]> {
    const branchSummary = await this.git.branchLocal();
    return branchSummary.all;
  }

  async createBranch(branchName: string, checkout: boolean = true): Promise<void> {
    if (checkout) {
      await this.git.checkoutLocalBranch(branchName);
    } else {
      await this.git.branch([branchName]);
    }
  }

  async checkoutBranch(branchName: string): Promise<void> {
    await this.git.checkout(branchName);
  }

  async stageAll(): Promise<void> {
    await this.git.add('.');
  }

  async stageFiles(files: string[]): Promise<void> {
    await this.git.add(files);
  }

  async commit(message: string): Promise<string> {
    const result = await this.git.commit(message);
    return result.commit;
  }

  async push(remote: string = 'origin', branch?: string, setUpstream: boolean = false): Promise<void> {
    const currentBranch = branch || await this.getCurrentBranch();
    const args = setUpstream ? ['--set-upstream', remote, currentBranch] : [remote, currentBranch];
    await this.git.push(args);
  }

  async getRemoteUrl(remote: string = 'origin'): Promise<string | null> {
    try {
      const remotes = await this.git.getRemotes(true);
      const originRemote = remotes.find(r => r.name === remote);
      return originRemote?.refs.fetch || originRemote?.refs.push || null;
    } catch {
      return null;
    }
  }

  async getStagedDiff(): Promise<string> {
    return this.git.diff(['--cached']);
  }

  async getUnstagedDiff(): Promise<string> {
    return this.git.diff();
  }

  async getAllDiff(): Promise<string> {
    const staged = await this.getStagedDiff();
    const unstaged = await this.getUnstagedDiff();
    return staged + '\n' + unstaged;
  }

  async getDefaultBranch(): Promise<string> {
    try {
      // Try to get the default branch from remote
      const remotes = await this.git.remote(['show', 'origin']);
      if (remotes) {
        const match = remotes.match(/HEAD branch:\s*(\S+)/);
        if (match) {
          return match[1];
        }
      }
    } catch {
      // Ignore errors
    }

    // Fallback: check which common branches exist locally
    const branches = await this.getBranches();
    const commonDefaults = ['main', 'master', 'develop', 'dev'];
    for (const branch of commonDefaults) {
      if (branches.includes(branch)) {
        return branch;
      }
    }

    // Last resort: return the first branch or 'main'
    return branches[0] || 'main';
  }

  /**
   * Get the preferred target branch for MRs
   * Prioritizes dev/develop/development over main/master
   */
  async getMRTargetBranch(): Promise<string> {
    const branches = await this.getBranches();
    
    // Priority order: dev branches first, then main branches
    const priorityOrder = ['develop', 'development', 'dev', 'main', 'master'];
    
    for (const branch of priorityOrder) {
      if (branches.includes(branch)) {
        return branch;
      }
    }

    // If none found, try to get the default branch from remote
    try {
      const remotes = await this.git.remote(['show', 'origin']);
      if (remotes) {
        const match = remotes.match(/HEAD branch:\s*(\S+)/);
        if (match) {
          return match[1];
        }
      }
    } catch {
      // Ignore errors
    }

    // Last resort: return the first branch or 'main'
    return branches[0] || 'main';
  }

  async getDiffWithBranch(targetBranch: string): Promise<string> {
    const currentBranch = await this.getCurrentBranch();
    
    try {
      // First, try to fetch the target branch to make sure it exists
      const branches = await this.getBranches();
      
      // Check if target branch exists locally
      if (!branches.includes(targetBranch)) {
        // Try to find it in remote
        try {
          await this.git.fetch(['origin', targetBranch]);
        } catch {
          // Branch might not exist on remote either, try common alternatives
          const defaultBranch = await this.getDefaultBranch();
          if (defaultBranch !== targetBranch && branches.includes(defaultBranch)) {
            targetBranch = defaultBranch;
          } else {
            // Can't find a valid base branch, return empty diff
            return '';
          }
        }
      }
      
      return await this.git.diff([`${targetBranch}...${currentBranch}`]);
    } catch {
      // If diff fails, try without the three-dot notation
      try {
        return await this.git.diff([targetBranch, currentBranch]);
      } catch {
        // Last resort: return all changes as diff
        return await this.getAllDiff();
      }
    }
  }

  async getChangedFiles(): Promise<FileDiff[]> {
    const status = await this.getStatus();
    const fileDiffs: FileDiff[] = [];

    // Process all changed files
    const allFiles = [
      ...status.modified.map(f => ({ path: f, status: 'modified' as const })),
      ...status.created.map(f => ({ path: f, status: 'added' as const })),
      ...status.deleted.map(f => ({ path: f, status: 'deleted' as const })),
      ...status.renamed.map(f => ({ path: f.to, status: 'renamed' as const })),
      ...status.not_added.map(f => ({ path: f, status: 'added' as const })),
    ];

    for (const file of allFiles) {
      try {
        const diff = await this.git.diff([file.path]);
        const lines = diff.split('\n');
        let additions = 0;
        let deletions = 0;

        for (const line of lines) {
          if (line.startsWith('+') && !line.startsWith('+++')) {
            additions++;
          } else if (line.startsWith('-') && !line.startsWith('---')) {
            deletions++;
          }
        }

        fileDiffs.push({
          path: file.path,
          status: file.status,
          additions,
          deletions,
          content: diff
        });
      } catch {
        // File might be new and not diffable
        fileDiffs.push({
          path: file.path,
          status: file.status,
          additions: 0,
          deletions: 0,
          content: ''
        });
      }
    }

    return fileDiffs;
  }

  async getFileContent(filePath: string): Promise<string> {
    const fullPath = path.join(this.workingDir, filePath);
    const fs = await import('fs/promises');
    return fs.readFile(fullPath, 'utf-8');
  }

  async getCommitsBetween(fromRef: string, toRef: string): Promise<Array<{ hash: string; message: string; author: string; date: string }>> {
    try {
      const log = await this.git.log({ from: fromRef, to: toRef });
      return log.all.map(commit => ({
        hash: commit.hash,
        message: commit.message,
        author: commit.author_name,
        date: commit.date
      }));
    } catch {
      // If the ref doesn't exist, try to find the default branch
      try {
        const defaultBranch = await this.getDefaultBranch();
        if (defaultBranch !== fromRef) {
          const log = await this.git.log({ from: defaultBranch, to: toRef });
          return log.all.map(commit => ({
            hash: commit.hash,
            message: commit.message,
            author: commit.author_name,
            date: commit.date
          }));
        }
      } catch {
        // Ignore
      }
      
      // Fallback: return recent commits from current branch
      try {
        const log = await this.git.log({ maxCount: 10 });
        return log.all.map(commit => ({
          hash: commit.hash,
          message: commit.message,
          author: commit.author_name,
          date: commit.date
        }));
      } catch {
        return [];
      }
    }
  }

  async getLastCommitMessage(): Promise<string> {
    const log = await this.git.log({ maxCount: 1 });
    return log.latest?.message || '';
  }

  extractProjectInfo(): { namespace: string; project: string } | null {
    // This will be called after getting remote URL
    return null;
  }

  static parseGitLabUrl(remoteUrl: string): { namespace: string; project: string } | null {
    // Handle SSH format: git@gitlab.example.com:namespace/project.git
    const sshMatch = remoteUrl.match(/git@[^:]+:(.+?)(?:\.git)?$/);
    if (sshMatch) {
      const parts = sshMatch[1].split('/');
      if (parts.length >= 2) {
        const project = parts.pop()!;
        const namespace = parts.join('/');
        return { namespace, project };
      }
    }

    // Handle HTTPS format: https://gitlab.example.com/namespace/project.git
    const httpsMatch = remoteUrl.match(/https?:\/\/[^/]+\/(.+?)(?:\.git)?$/);
    if (httpsMatch) {
      const parts = httpsMatch[1].split('/');
      if (parts.length >= 2) {
        const project = parts.pop()!;
        const namespace = parts.join('/');
        return { namespace, project };
      }
    }

    return null;
  }
}