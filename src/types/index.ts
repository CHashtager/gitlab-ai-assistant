// Configuration types
export interface GitLabAIConfig {
  gitlabUrl: string;
  gitlabToken: string;
  llmProvider: LLMProvider;
  llmApiUrl: string;
  llmApiKey: string;
  llmModel: string;
  branchNamingConvention: string;
  branchTypes: string[];
  commitMessageConvention: CommitConvention;
  customCommitTemplate: string;
  reviewMode: ReviewMode;
  businessContextFile: string;
  autoAssignReviewers: boolean;
  defaultTargetBranch: string;
  mrTemplate: string;
  enableDraftMR: boolean;
}

export type LLMProvider = 'openai' | 'anthropic' | 'ollama' | 'custom';
export type CommitConvention = 'conventional' | 'angular' | 'gitmoji' | 'custom';
export type ReviewMode = 'syntax' | 'logic' | 'business' | 'comprehensive';

// GitLab API types
export interface GitLabProject {
  id: number;
  name: string;
  path_with_namespace: string;
  web_url: string;
  default_branch: string;
}

export interface GitLabBranch {
  name: string;
  commit: {
    id: string;
    message: string;
  };
  protected: boolean;
}

export interface GitLabMergeRequest {
  id: number;
  iid: number;
  title: string;
  description: string;
  state: string;
  web_url: string;
  source_branch: string;
  target_branch: string;
  draft: boolean;
  changes_count: string;
  diff_refs: {
    base_sha: string;
    head_sha: string;
    start_sha: string;
  };
}

export interface GitLabMRChange {
  old_path: string;
  new_path: string;
  diff: string;
  new_file: boolean;
  renamed_file: boolean;
  deleted_file: boolean;
}

export interface GitLabDiffNote {
  body: string;
  position: {
    base_sha: string;
    start_sha: string;
    head_sha: string;
    position_type: 'text';
    old_path: string;
    new_path: string;
    old_line: number | null;
    new_line: number | null;
  };
}

export interface GitLabUser {
  id: number;
  username: string;
  name: string;
  email: string;
}

// LLM types
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// Code review types
export interface CodeReviewComment {
  file: string;
  line: number;
  severity: 'info' | 'warning' | 'error' | 'suggestion';
  category: 'syntax' | 'logic' | 'performance' | 'security' | 'style' | 'business';
  message: string;
  suggestion?: string;
}

export interface CodeReviewResult {
  summary: string;
  comments: CodeReviewComment[];
  overallScore: number;
  recommendations: string[];
}

// Branch creation types
export interface BranchInfo {
  type: string;
  ticket: string;
  description: string;
  fullName: string;
}

// Commit types
export interface CommitInfo {
  type: string;
  scope?: string;
  subject: string;
  body?: string;
  breaking?: boolean;
  issues?: string[];
  fullMessage: string;
}

// Git diff types
export interface FileDiff {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  content: string;
}

// Business context types
export interface BusinessContext {
  projectDescription?: string;
  architecture?: string;
  codingStandards?: string;
  domainTerms?: Record<string, string>;
  securityRequirements?: string[];
  performanceRequirements?: string[];
  customRules?: string[];
}