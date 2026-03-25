/**
 * Tests for DeploymentPipelineService
 *
 * Covers:
 *   - Happy path: all stages succeed → completed record with URLs
 *   - Generation failure → failed record at 'generating' stage
 *   - GitHub creation failure → failed record at 'creating_repo' stage
 *   - GitHub push failure → failed record at 'pushing_code' stage
 *   - Vercel failure → failed record at 'deploying' stage
 *   - DB insert failure → early return without crashing
 *
 * Issue: #96
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the template-generator service before it is imported (avoids path polyfill issue)
vi.mock('./template-generator.service', () => ({
    templateGeneratorService: { generate: vi.fn() },
    mapCategoryToFamily: vi.fn().mockReturnValue('stellar-dex'),
}));

import { DeploymentPipelineService } from './deployment-pipeline.service';
import type { DeploymentPipelineRequest } from './deployment-pipeline.service';
import type { CustomizationConfig } from '@craft/types';

// ── Supabase mock ─────────────────────────────────────────────────────────────

const mockUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
const mockInsert = vi.fn().mockResolvedValue({ error: null });
const mockSelect = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        from: (table: string) => ({
            insert: mockInsert,
            update: mockUpdate,
            select: (cols: string) => ({
                eq: (col: string, val: string) => ({
                    single: () => {
                        if (table === 'templates') {
                            return Promise.resolve({ data: { category: 'dex' }, error: null });
                        }
                        return Promise.resolve({ data: null, error: null });
                    },
                }),
            }),
        }),
        auth: { getUser: vi.fn() },
    }),
}));

// ── Fixture ───────────────────────────────────────────────────────────────────

const customization: CustomizationConfig = {
    branding: {
        appName: 'TestApp',
        primaryColor: '#000000',
        secondaryColor: '#ffffff',
        fontFamily: 'Inter',
    },
    features: {
        enableCharts: true,
        enableTransactionHistory: true,
        enableAnalytics: false,
        enableNotifications: false,
    },
    stellar: {
        network: 'testnet',
        horizonUrl: 'https://horizon-testnet.stellar.org',
    },
};

const request: DeploymentPipelineRequest = {
    userId: 'user-123',
    templateId: 'template-abc',
    name: 'my-dex-app',
    customization,
};

// ── Mock dependencies ─────────────────────────────────────────────────────────

function makeGeneratorMock(success = true) {
    return {
        generate: vi.fn().mockResolvedValue(
            success
                ? {
                      success: true,
                      generatedFiles: [{ path: 'src/index.ts', content: 'export {}', type: 'code' }],
                      errors: [],
                  }
                : {
                      success: false,
                      generatedFiles: [],
                      errors: [{ file: 'unknown', message: 'generation error', severity: 'error' }],
                  },
        ),
    };
}

function makeGithubMock(fail = false) {
    return {
        createRepository: fail
            ? vi.fn().mockRejectedValue(Object.assign(new Error('GitHub error'), { code: 'NETWORK_ERROR' }))
            : vi.fn().mockResolvedValue({
                  repository: {
                      id: 1,
                      url: 'https://github.com/org/my-dex-app',
                      cloneUrl: 'https://github.com/org/my-dex-app.git',
                      sshUrl: 'git@github.com:org/my-dex-app.git',
                      fullName: 'org/my-dex-app',
                      defaultBranch: 'main',
                      private: true,
                  },
                  resolvedName: 'my-dex-app',
              }),
    };
}

function makeGithubPushMock(fail = false) {
    return {
        pushGeneratedCode: fail
            ? vi.fn().mockRejectedValue(new Error('Push failed'))
            : vi.fn().mockResolvedValue({
                  owner: 'org',
                  repo: 'my-dex-app',
                  branch: 'main',
                  commitSha: 'abc1234',
                  treeSha: 'def5678',
                  commitUrl: 'https://github.com/org/my-dex-app/commit/abc1234',
                  previousCommitSha: '000',
                  createdBranch: false,
                  fileCount: 1,
              }),
    };
}

function makeVercelMock(fail = false) {
    return {
        createProject: fail
            ? vi.fn().mockRejectedValue(Object.assign(new Error('Vercel error'), { code: 'UNKNOWN' }))
            : vi.fn().mockResolvedValue({
                  id: 'prj_abc',
                  name: 'craft-my-dex-app',
                  url: 'craft-my-dex-app.vercel.app',
              }),
        triggerDeployment: vi.fn().mockResolvedValue({
            deploymentId: 'dpl_xyz',
            deploymentUrl: 'https://craft-my-dex-app.vercel.app',
            status: 'QUEUED',
        }),
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DeploymentPipelineService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset insert to succeed by default
        mockInsert.mockResolvedValue({ error: null });
        mockUpdate.mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
        });
    });

    it('completes the full pipeline and returns URLs', async () => {
        const svc = new DeploymentPipelineService(
            makeGeneratorMock(),
            makeGithubMock(),
            makeGithubPushMock(),
            makeVercelMock(),
        );

        const result = await svc.deploy(request);

        expect(result.success).toBe(true);
        expect(result.deploymentId).toBeTruthy();
        expect(result.repositoryUrl).toBe('https://github.com/org/my-dex-app');
        expect(result.deploymentUrl).toBe('https://craft-my-dex-app.vercel.app');
        expect(result.errorMessage).toBeUndefined();
    });

    it('fails at generating stage when code generation fails', async () => {
        const svc = new DeploymentPipelineService(
            makeGeneratorMock(false),
            makeGithubMock(),
            makeGithubPushMock(),
            makeVercelMock(),
        );

        const result = await svc.deploy(request);

        expect(result.success).toBe(false);
        expect(result.failedStage).toBe('generating');
        expect(result.errorMessage).toContain('generation error');
    });

    it('fails at creating_repo stage when GitHub throws', async () => {
        const svc = new DeploymentPipelineService(
            makeGeneratorMock(),
            makeGithubMock(true),
            makeGithubPushMock(),
            makeVercelMock(),
        );

        const result = await svc.deploy(request);

        expect(result.success).toBe(false);
        expect(result.failedStage).toBe('creating_repo');
        expect(result.errorMessage).toContain('GitHub error');
    });

    it('fails at pushing_code stage when push throws', async () => {
        const svc = new DeploymentPipelineService(
            makeGeneratorMock(),
            makeGithubMock(),
            makeGithubPushMock(true),
            makeVercelMock(),
        );

        const result = await svc.deploy(request);

        expect(result.success).toBe(false);
        expect(result.failedStage).toBe('pushing_code');
        expect(result.errorMessage).toContain('Push failed');
    });

    it('fails at deploying stage when Vercel throws', async () => {
        const svc = new DeploymentPipelineService(
            makeGeneratorMock(),
            makeGithubMock(),
            makeGithubPushMock(),
            makeVercelMock(true),
        );

        const result = await svc.deploy(request);

        expect(result.success).toBe(false);
        expect(result.failedStage).toBe('deploying');
        expect(result.errorMessage).toContain('Vercel error');
    });

    it('returns early when DB insert fails', async () => {
        mockInsert.mockResolvedValueOnce({ error: { message: 'DB constraint violation' } });

        const svc = new DeploymentPipelineService(
            makeGeneratorMock(),
            makeGithubMock(),
            makeGithubPushMock(),
            makeVercelMock(),
        );

        const result = await svc.deploy(request);

        expect(result.success).toBe(false);
        expect(result.errorMessage).toContain('Failed to create deployment record');
    });

    it('always returns a deploymentId even on failure', async () => {
        const svc = new DeploymentPipelineService(
            makeGeneratorMock(false),
            makeGithubMock(),
            makeGithubPushMock(),
            makeVercelMock(),
        );

        const result = await svc.deploy(request);

        expect(result.deploymentId).toBeTruthy();
        expect(typeof result.deploymentId).toBe('string');
    });
});
