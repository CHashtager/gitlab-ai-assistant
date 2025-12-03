import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  GitLabProject,
  GitLabBranch,
  GitLabMergeRequest,
  GitLabMRChange,
  GitLabDiffNote,
  GitLabUser,
  GitLabAIConfig
} from '../types';

export class GitLabService {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor(config: GitLabAIConfig) {
    this.baseUrl = config.gitlabUrl.replace(/\/$/, '');
    
    this.client = axios.create({
      baseURL: `${this.baseUrl}/api/v4`,
      headers: {
        'PRIVATE-TOKEN': config.gitlabToken,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      response => response,
      (error: AxiosError) => {
        if (error.response) {
          const message = (error.response.data as any)?.message || error.message;
          throw new Error(`GitLab API Error (${error.response.status}): ${message}`);
        }
        throw error;
      }
    );
  }

  // Project methods
  async getCurrentUser(): Promise<GitLabUser> {
    const response = await this.client.get<GitLabUser>('/user');
    return response.data;
  }

  async getProject(projectPath: string): Promise<GitLabProject> {
    const encodedPath = encodeURIComponent(projectPath);
    const response = await this.client.get<GitLabProject>(`/projects/${encodedPath}`);
    return response.data;
  }

  async searchProjects(search: string): Promise<GitLabProject[]> {
    const response = await this.client.get<GitLabProject[]>('/projects', {
      params: { search, membership: true }
    });
    return response.data;
  }

  // Branch methods
  async getBranches(projectId: number): Promise<GitLabBranch[]> {
    const response = await this.client.get<GitLabBranch[]>(`/projects/${projectId}/repository/branches`);
    return response.data;
  }

  async getBranch(projectId: number, branchName: string): Promise<GitLabBranch> {
    const encodedBranch = encodeURIComponent(branchName);
    const response = await this.client.get<GitLabBranch>(`/projects/${projectId}/repository/branches/${encodedBranch}`);
    return response.data;
  }

  async createBranch(projectId: number, branchName: string, ref: string): Promise<GitLabBranch> {
    const response = await this.client.post<GitLabBranch>(`/projects/${projectId}/repository/branches`, {
      branch: branchName,
      ref: ref
    });
    return response.data;
  }

  // Merge Request methods
  async createMergeRequest(
    projectId: number,
    sourceBranch: string,
    targetBranch: string,
    title: string,
    description: string,
    options: {
      draft?: boolean;
      assigneeIds?: number[];
      reviewerIds?: number[];
      labels?: string[];
      removeSourceBranch?: boolean;
    } = {}
  ): Promise<GitLabMergeRequest> {
    const mrTitle = options.draft ? `Draft: ${title}` : title;
    
    const response = await this.client.post<GitLabMergeRequest>(`/projects/${projectId}/merge_requests`, {
      source_branch: sourceBranch,
      target_branch: targetBranch,
      title: mrTitle,
      description: description,
      assignee_ids: options.assigneeIds,
      reviewer_ids: options.reviewerIds,
      labels: options.labels?.join(','),
      remove_source_branch: options.removeSourceBranch ?? true
    });
    return response.data;
  }

  async getMergeRequest(projectId: number, mrIid: number): Promise<GitLabMergeRequest> {
    const response = await this.client.get<GitLabMergeRequest>(`/projects/${projectId}/merge_requests/${mrIid}`);
    return response.data;
  }

  async getMergeRequestChanges(projectId: number, mrIid: number): Promise<GitLabMRChange[]> {
    const response = await this.client.get<{ changes: GitLabMRChange[] }>(
      `/projects/${projectId}/merge_requests/${mrIid}/changes`
    );
    return response.data.changes;
  }

  async getMergeRequestDiffs(projectId: number, mrIid: number): Promise<any[]> {
    const response = await this.client.get(`/projects/${projectId}/merge_requests/${mrIid}/diffs`);
    return response.data;
  }

  async updateMergeRequest(
    projectId: number,
    mrIid: number,
    updates: {
      title?: string;
      description?: string;
      assigneeIds?: number[];
      reviewerIds?: number[];
      labels?: string[];
    }
  ): Promise<GitLabMergeRequest> {
    const response = await this.client.put<GitLabMergeRequest>(
      `/projects/${projectId}/merge_requests/${mrIid}`,
      {
        title: updates.title,
        description: updates.description,
        assignee_ids: updates.assigneeIds,
        reviewer_ids: updates.reviewerIds,
        labels: updates.labels?.join(',')
      }
    );
    return response.data;
  }

  async listMergeRequests(
    projectId: number,
    options: {
      state?: 'opened' | 'closed' | 'merged' | 'all';
      sourceBranch?: string;
      targetBranch?: string;
    } = {}
  ): Promise<GitLabMergeRequest[]> {
    const response = await this.client.get<GitLabMergeRequest[]>(`/projects/${projectId}/merge_requests`, {
      params: {
        state: options.state || 'opened',
        source_branch: options.sourceBranch,
        target_branch: options.targetBranch
      }
    });
    return response.data;
  }

  // Code Review / Discussion methods
  async createMRDiscussion(
    projectId: number,
    mrIid: number,
    body: string,
    position?: {
      baseSha: string;
      startSha: string;
      headSha: string;
      oldPath: string;
      newPath: string;
      oldLine?: number;
      newLine?: number;
    }
  ): Promise<any> {
    const payload: any = { body };

    if (position) {
      payload.position = {
        base_sha: position.baseSha,
        start_sha: position.startSha,
        head_sha: position.headSha,
        position_type: 'text',
        old_path: position.oldPath,
        new_path: position.newPath,
        old_line: position.oldLine,
        new_line: position.newLine
      };
    }

    const response = await this.client.post(
      `/projects/${projectId}/merge_requests/${mrIid}/discussions`,
      payload
    );
    return response.data;
  }

  async createMRNote(projectId: number, mrIid: number, body: string): Promise<any> {
    const response = await this.client.post(
      `/projects/${projectId}/merge_requests/${mrIid}/notes`,
      { body }
    );
    return response.data;
  }

  async getMRDiscussions(projectId: number, mrIid: number): Promise<any[]> {
    const response = await this.client.get(`/projects/${projectId}/merge_requests/${mrIid}/discussions`);
    return response.data;
  }

  // File methods
  async getFileContent(projectId: number, filePath: string, ref: string): Promise<string> {
    const encodedPath = encodeURIComponent(filePath);
    const response = await this.client.get(`/projects/${projectId}/repository/files/${encodedPath}`, {
      params: { ref }
    });
    return Buffer.from(response.data.content, 'base64').toString('utf-8');
  }

  // CODEOWNERS methods
  async getCodeOwners(projectId: number, ref: string = 'main'): Promise<string | null> {
    try {
      const paths = ['CODEOWNERS', '.gitlab/CODEOWNERS', 'docs/CODEOWNERS'];
      for (const path of paths) {
        try {
          return await this.getFileContent(projectId, path, ref);
        } catch {
          continue;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  // Project members
  async getProjectMembers(projectId: number): Promise<GitLabUser[]> {
    const response = await this.client.get<GitLabUser[]>(`/projects/${projectId}/members/all`);
    return response.data;
  }

  async searchUsers(search: string): Promise<GitLabUser[]> {
    const response = await this.client.get<GitLabUser[]>('/users', {
      params: { search }
    });
    return response.data;
  }

  // Utility method to get diff between branches
  async compareBranches(projectId: number, from: string, to: string): Promise<{ diffs: any[]; commits: any[] }> {
    const response = await this.client.get(`/projects/${projectId}/repository/compare`, {
      params: { from, to }
    });
    return response.data;
  }

  // Get project CI configuration
  async getCIConfig(projectId: number, ref: string = 'main'): Promise<string | null> {
    try {
      return await this.getFileContent(projectId, '.gitlab-ci.yml', ref);
    } catch {
      return null;
    }
  }
}