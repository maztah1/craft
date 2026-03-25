/**
 * VercelService
 *
 * Manages Vercel API interactions for project creation and deployment.
 *
 * Configuration (env vars):
 *   VERCEL_TOKEN     — Vercel API token (required)
 *   VERCEL_TEAM_ID   — Optional. When set, all projects are scoped to this team.
 *
 * Responsibilities:
 *   - Create a Vercel project linked to a GitHub repository
 *   - Configure environment variables on the project
 *   - Trigger a deployment and poll/return the deployment URL
 *   - Surface rate-limit and auth errors with structured codes
 *
 * Design doc properties satisfied:
 *   Property 20 — Deployment Pipeline Sequence
 *   Property 21 — Vercel Environment Variable Configuration
 *   Property 22 — Vercel Build Configuration
 *   Property 23 — Deployment Error Capture
 */

import type { VercelEnvVar } from '@/lib/env/env-template-generator';

const VERCEL_API_BASE = 'https://api.vercel.com';

// ── Error types ───────────────────────────────────────────────────────────────

export type VercelErrorCode =
    | 'AUTH_FAILED'
    | 'RATE_LIMITED'
    | 'NETWORK_ERROR'
    | 'PROJECT_EXISTS'
    | 'UNKNOWN';

export class VercelApiError extends Error {
    constructor(
        message: string,
        public readonly code: VercelErrorCode,
        public readonly retryAfterMs?: number,
    ) {
        super(message);
        this.name = 'VercelApiError';
    }
}

// ── Request / response types ──────────────────────────────────────────────────

export interface CreateVercelProjectRequest {
    /** Desired project name (will be used as-is; caller should sanitize). */
    name: string;
    /** GitHub "owner/repo" slug. */
    gitRepo: string;
    /** Environment variables to configure on the project. */
    envVars: VercelEnvVar[];
    /** Framework preset — always nextjs for CRAFT templates. */
    framework?: string;
    /** Turborepo build command override. */
    buildCommand?: string;
    /** Output directory override. */
    outputDirectory?: string;
}

export interface VercelProject {
    id: string;
    name: string;
    /** Vercel-assigned project URL (without https://). */
    url: string;
}

export interface TriggerDeploymentResult {
    deploymentId: string;
    /** Full deployment URL including https://. */
    deploymentUrl: string;
    /** Raw Vercel deployment status at creation time. */
    status: string;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class VercelService {
    private get token(): string {
        return process.env.VERCEL_TOKEN ?? '';
    }

    private get teamId(): string | null {
        return process.env.VERCEL_TEAM_ID || null;
    }

    private buildHeaders(): Record<string, string> {
        if (!this.token) {
            throw new VercelApiError('VERCEL_TOKEN is not configured', 'AUTH_FAILED');
        }
        return {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
        };
    }

    /** Append ?teamId=... when a team scope is configured. */
    private url(path: string): string {
        const base = `${VERCEL_API_BASE}${path}`;
        return this.teamId ? `${base}?teamId=${this.teamId}` : base;
    }

    /**
     * Create a Vercel project linked to a GitHub repository and configure
     * environment variables. Returns the created project record.
     */
    async createProject(request: CreateVercelProjectRequest): Promise<VercelProject> {
        const headers = this.buildHeaders();

        const payload: Record<string, unknown> = {
            name: request.name,
            framework: request.framework ?? 'nextjs',
            gitRepository: {
                type: 'github',
                repo: request.gitRepo,
            },
        };

        if (request.buildCommand) {
            payload.buildCommand = request.buildCommand;
        }
        if (request.outputDirectory) {
            payload.outputDirectory = request.outputDirectory;
        }

        let res: Response;
        try {
            res = await fetch(this.url('/v9/projects'), {
                method: 'POST',
                headers,
                body: JSON.stringify(payload),
            });
        } catch (err: unknown) {
            throw new VercelApiError(
                err instanceof Error ? err.message : 'Network request failed',
                'NETWORK_ERROR',
            );
        }

        const data = await res.json().catch(() => ({})) as Record<string, unknown>;

        if (res.status === 409) {
            throw new VercelApiError(
                `Vercel project "${request.name}" already exists`,
                'PROJECT_EXISTS',
            );
        }

        this.assertOk(res, data);

        const project: VercelProject = {
            id: data.id as string,
            name: data.name as string,
            url: `${data.name as string}.vercel.app`,
        };

        // Configure environment variables if provided
        if (request.envVars.length > 0) {
            await this.setEnvVars(project.id, request.envVars);
        }

        return project;
    }

    /**
     * Trigger a new deployment for an existing Vercel project.
     * Returns the deployment ID and URL immediately — the build runs async.
     */
    async triggerDeployment(projectId: string, gitRepo: string): Promise<TriggerDeploymentResult> {
        const headers = this.buildHeaders();

        // Derive owner/repo parts
        const [owner, repo] = gitRepo.split('/');

        let res: Response;
        try {
            res = await fetch(this.url('/v13/deployments'), {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    name: repo,
                    gitSource: {
                        type: 'github',
                        org: owner,
                        repo,
                        ref: 'main',
                    },
                    projectSettings: {
                        framework: 'nextjs',
                    },
                }),
            });
        } catch (err: unknown) {
            throw new VercelApiError(
                err instanceof Error ? err.message : 'Network request failed',
                'NETWORK_ERROR',
            );
        }

        const data = await res.json().catch(() => ({})) as Record<string, unknown>;
        this.assertOk(res, data);

        const deploymentId = data.id as string;
        const deploymentUrl = `https://${data.url as string}`;

        return {
            deploymentId,
            deploymentUrl,
            status: (data.status as string) ?? 'QUEUED',
        };
    }

    /**
     * Verify that the configured token can reach the Vercel API.
     */
    async validateAccess(): Promise<boolean> {
        try {
            const res = await fetch(this.url('/v2/user'), {
                headers: this.buildHeaders(),
            });
            return res.ok;
        } catch {
            return false;
        }
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private async setEnvVars(projectId: string, envVars: VercelEnvVar[]): Promise<void> {
        const headers = this.buildHeaders();

        let res: Response;
        try {
            res = await fetch(this.url(`/v9/projects/${projectId}/env`), {
                method: 'POST',
                headers,
                body: JSON.stringify(envVars),
            });
        } catch (err: unknown) {
            throw new VercelApiError(
                err instanceof Error ? err.message : 'Failed to set env vars',
                'NETWORK_ERROR',
            );
        }

        const data = await res.json().catch(() => ({})) as Record<string, unknown>;
        this.assertOk(res, data);
    }

    private assertOk(res: Response, data: Record<string, unknown>): void {
        if (res.ok) return;

        const message = (data.error as Record<string, unknown>)?.message as string
            ?? data.message as string
            ?? `Vercel API error: ${res.status}`;

        if (res.status === 401 || res.status === 403) {
            throw new VercelApiError(message, 'AUTH_FAILED');
        }

        if (res.status === 429) {
            const retryAfterSec = parseInt(res.headers.get('Retry-After') ?? '0', 10);
            throw new VercelApiError(message, 'RATE_LIMITED', retryAfterSec * 1000);
        }

        throw new VercelApiError(message, 'UNKNOWN');
    }
}

export const vercelService = new VercelService();
