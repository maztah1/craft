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
 *   - Validate required configuration at construction time via validateConfig()
 *   - Create a Vercel project linked to a GitHub repository
 *   - Configure environment variables on the project
 *   - Trigger a deployment and return the deployment URL
 *   - Surface rate-limit and auth errors with structured codes via a single
 *     shared request() helper (no duplicated fetch/error-handling logic)
 *
 * Design doc properties satisfied:
 *   Property 20 — Deployment Pipeline Sequence
 *   Property 21 — Vercel Environment Variable Configuration
 *   Property 22 — Vercel Build Configuration
 *   Property 23 — Deployment Error Capture
 */

import type { VercelEnvVar } from '@/lib/env/env-template-generator';

export type { VercelEnvVar };

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

// ── Config validation ─────────────────────────────────────────────────────────

export interface VercelConfigValidationResult {
    valid: boolean;
    /** Present when valid is false. */
    missing?: 'VERCEL_TOKEN';
}

/**
 * Validates that all required Vercel environment variables are present.
 * Call this at application startup or before the first deployment operation.
 */
export function validateVercelConfig(): VercelConfigValidationResult {
    if (!process.env.VERCEL_TOKEN) {
        return { valid: false, missing: 'VERCEL_TOKEN' };
    }
    return { valid: true };
}

// ── Service ───────────────────────────────────────────────────────────────────

interface FetchLike {
    (input: string, init?: RequestInit): Promise<Response>;
}

export class VercelService {
    constructor(private readonly _fetch: FetchLike = fetch) {}

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
     * Shared request helper — all Vercel API calls go through here.
     * Handles network errors, status-to-error-code mapping, and JSON parsing.
     */
    private async request<T = Record<string, unknown>>(
        path: string,
        init: RequestInit,
        /** Optional status code that should be treated as a specific error before assertOk. */
        earlyThrow?: { status: number; code: VercelErrorCode; message: string },
    ): Promise<T> {
        const headers = this.buildHeaders(); // throws AUTH_FAILED if token missing

        let res: Response;
        try {
            res = await this._fetch(this.url(path), {
                ...init,
                headers: { ...headers, ...(init.headers ?? {}) },
            });
        } catch (err: unknown) {
            throw new VercelApiError(
                err instanceof Error ? err.message : 'Network request failed',
                'NETWORK_ERROR',
            );
        }

        const data = await res.json().catch(() => ({})) as Record<string, unknown>;

        if (earlyThrow && res.status === earlyThrow.status) {
            throw new VercelApiError(earlyThrow.message, earlyThrow.code);
        }

        this.assertOk(res, data);
        return data as T;
    }

    /**
     * Create a Vercel project linked to a GitHub repository and configure
     * environment variables. Returns the created project record.
     */
    async createProject(request: CreateVercelProjectRequest): Promise<VercelProject> {
        const payload: Record<string, unknown> = {
            name: request.name,
            framework: request.framework ?? 'nextjs',
            gitRepository: { type: 'github', repo: request.gitRepo },
        };
        if (request.buildCommand) payload.buildCommand = request.buildCommand;
        if (request.outputDirectory) payload.outputDirectory = request.outputDirectory;

        const data = await this.request('/v9/projects', {
            method: 'POST',
            body: JSON.stringify(payload),
        }, {
            status: 409,
            code: 'PROJECT_EXISTS',
            message: `Vercel project "${request.name}" already exists`,
        });

        const project: VercelProject = {
            id: data.id as string,
            name: data.name as string,
            url: `${data.name as string}.vercel.app`,
        };

        if (request.envVars.length > 0) {
            await this.request(`/v9/projects/${project.id}/env`, {
                method: 'POST',
                body: JSON.stringify(request.envVars),
            });
        }

        return project;
    }

    /**
     * Trigger a new deployment for an existing Vercel project.
     * Returns the deployment ID and URL immediately — the build runs async.
     */
    async triggerDeployment(projectId: string, gitRepo: string): Promise<TriggerDeploymentResult> {
        const [owner, repo] = gitRepo.split('/');

        const data = await this.request('/v13/deployments', {
            method: 'POST',
            body: JSON.stringify({
                name: repo,
                gitSource: { type: 'github', org: owner, repo, ref: 'main' },
                projectSettings: { framework: 'nextjs' },
            }),
        });

        return {
            deploymentId: data.id as string,
            deploymentUrl: `https://${data.url as string}`,
            status: (data.status as string) ?? 'QUEUED',
        };
    }


    /**
     * Verify that the configured token can reach the Vercel API.
     */
    async validateAccess(): Promise<boolean> {
        try {
            const res = await this._fetch(this.url('/v2/user'), {
                headers: this.buildHeaders(),
            });
            return res.ok;
        } catch {
            return false;
        }
    }

    /**
     * Delete a Vercel project by ID (Issue #110).
     * Uses the shared request() helper for consistent error handling.
     * Logs errors but does not throw - best effort cleanup.
     */
    async deleteProject(projectId: string): Promise<void> {
        try {
            await this.request(`/v10/projects/${projectId}`, {
                method: 'DELETE',
            });
        } catch (error: any) {
            console.error(`Vercel project delete failed for ${projectId}:`, error.message);
            // Continue - DB deletion should succeed regardless
        }
    }


    // ── Private helpers ───────────────────────────────────────────────────────

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

