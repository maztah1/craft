import { CustomizationConfig } from './customization';

export type DeploymentStatusType =
    | 'pending'
    | 'generating'
    | 'creating_repo'
    | 'pushing_code'
    | 'deploying'
    | 'completed'
    | 'failed';

export interface Deployment {
    id: string;
    userId: string;
    templateId: string;
    name: string;
    customizationConfig: CustomizationConfig;
    repositoryUrl?: string;
    vercelProjectId?: string;
    vercelDeploymentId?: string;
    deploymentUrl?: string;
    customDomain?: string;
    status: DeploymentStatusType;
    errorMessage?: string;
    createdAt: Date;
    updatedAt: Date;
    deployedAt?: Date;
}

export type DeploymentStatus =
    | { stage: 'generating'; progress: number }
    | { stage: 'creating_repo'; progress: number }
    | { stage: 'pushing_code'; progress: number }
    | { stage: 'deploying_vercel'; progress: number }
    | { stage: 'completed'; url: string }
    | { stage: 'failed'; error: string };

export interface DeploymentLog {
    id: string;
    deploymentId: string;
    stage: string;
    message: string;
    level: 'info' | 'warn' | 'error';
    metadata?: Record<string, unknown>;
    createdAt: Date;
}

export interface DeploymentRequest {
    userId: string;
    templateId: string;
    customization: CustomizationConfig;
    repositoryName: string;
}

export interface DeploymentResult {
    deploymentId: string;
    repositoryUrl: string;
    vercelUrl: string;
    status: DeploymentStatus;
}

export interface GeneratedFile {
    path: string;
    content: string;
    type: 'code' | 'config' | 'asset';
}

export interface GenerationError {
    file: string;
    line?: number;
    message: string;
    severity: 'error' | 'warning';
}

export interface GenerationResult {
    success: boolean;
    generatedFiles: GeneratedFile[];
    errors: GenerationError[];
}

// ── GitHub repository creation ────────────────────────────────────────────────

export interface CreateRepoRequest {
    /** Desired repository name (will be sanitized before use). */
    name: string;
    description?: string;
    homepage?: string;
    topics?: string[];
    private: boolean;
    userId: string;
}

export interface Repository {
    /** GitHub repository numeric ID. */
    id: number;
    /** HTML URL — e.g. https://github.com/owner/repo */
    url: string;
    /** HTTPS clone URL — needed for subsequent git push steps. */
    cloneUrl: string;
    /** SSH clone URL. */
    sshUrl: string;
    /** "owner/repo" slug. */
    fullName: string;
    defaultBranch: string;
    private: boolean;
}

export type GitHubErrorCode =
    | 'COLLISION'
    | 'AUTH_FAILED'
    | 'RATE_LIMITED'
    | 'NETWORK_ERROR'
    | 'UNKNOWN';

export interface GitHubServiceError {
    code: GitHubErrorCode;
    message: string;
    /** Milliseconds to wait before retrying (populated for RATE_LIMITED). */
    retryAfterMs?: number;
}

export interface GenerationRequest {
    templateId: string;
    customization: CustomizationConfig;
    outputPath: string;
}

// ── Deployment Logs API ───────────────────────────────────────────────────────

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogsQueryParams {
    page: number;
    limit: number;
    order: 'asc' | 'desc';
    since?: string;
    level?: LogLevel;
    stage?: string;
}

export interface DeploymentLogResponse {
    id: string;
    deploymentId: string;
    /** ISO 8601 string mapped from created_at */
    timestamp: string;
    level: LogLevel;
    message: string;
}

export interface PaginatedLogsResponse {
    data: DeploymentLogResponse[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        hasNextPage: boolean;
    };
}
