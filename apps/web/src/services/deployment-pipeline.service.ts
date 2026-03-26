/**
 * DeploymentPipelineService
 *
 * Orchestrates the full deployment pipeline for a CRAFT template:
 *
 *   1. Persist a `pending` deployment record (DB)
 *   2. Generate code from template + customization config
 *   3. Create a private GitHub repository
 *   4. Push generated files to the repository
 *   5. Create a Vercel project linked to the repository
 *   6. Trigger a Vercel deployment
 *   7. Persist the final `completed` record with all URLs
 *
 * Failure handling:
 *   Any stage failure marks the deployment `failed` with a descriptive
 *   error_message and writes a structured log entry. The deployment record
 *   is always left in a terminal state so the UI can poll and surface errors.
 *
 * Rollback boundaries:
 *   - GitHub repo created but Vercel fails → deployment marked failed;
 *     the repo is left in place so the user can retry without losing code.
 *   - Partial code push → deployment marked failed; the repo may be empty
 *     or partial — the UI should prompt a retry.
 *
 * Design doc properties satisfied:
 *   Property 20 — Deployment Pipeline Sequence (generation → repo → push → vercel → URL)
 *   Property 21 — Vercel Environment Variable Configuration
 *   Property 22 — Vercel Build Configuration (nextjs + turborepo)
 *   Property 23 — Deployment Error Capture
 *   Property 24 — Deployment Status Progression
 *   Property 25 — Deployment Log Persistence
 *
 * Issue: #96
 * Branch: issue-096-implement-deployment-pipeline-orchestration
 */

import { createClient } from '@/lib/supabase/server';
import type { CustomizationConfig } from '@craft/types';
import type { DeploymentStatusType } from '@craft/types';
import { templateGeneratorService, type TemplateGeneratorService } from './template-generator.service';
import { githubService, type GitHubService } from './github.service';
import { githubPushService, type GitHubPushService } from './github-push.service';
import { vercelService, type VercelService } from './vercel.service';
import { buildVercelEnvVars } from '@/lib/env/env-template-generator';
import { mapCategoryToFamily } from './template-generator.service';
import type { TemplateFamilyId } from './code-generator.service';

// ── Request / result types ────────────────────────────────────────────────────

export interface DeploymentPipelineRequest {
    userId: string;
    templateId: string;
    customization: CustomizationConfig;
    /** Human-readable name for the deployment (used as repo name). */
    name: string;
}

export interface DeploymentPipelineResult {
    success: boolean;
    deploymentId: string;
    /** Present when success is true. */
    repositoryUrl?: string;
    /** Present when success is true. */
    deploymentUrl?: string;
    /** Present when success is false. */
    errorMessage?: string;
    /** Stage at which the pipeline failed (if applicable). */
    failedStage?: DeploymentStatusType;
}

// ── Internal stage logger ─────────────────────────────────────────────────────

type LogLevel = 'info' | 'warn' | 'error';

// ── Service ───────────────────────────────────────────────────────────────────

export class DeploymentPipelineService {
    constructor(
        private readonly _templateGeneratorService: Pick<TemplateGeneratorService, 'generate'> = templateGeneratorService,
        private readonly _githubService: Pick<GitHubService, 'createRepository'> = githubService,
        private readonly _githubPushService: Pick<GitHubPushService, 'pushGeneratedCode'> = githubPushService,
        private readonly _vercelService: Pick<VercelService, 'createProject' | 'triggerDeployment'> = vercelService,
    ) {}

    /**
     * Run the full deployment pipeline.
     * Never throws — all error paths return a resolved DeploymentPipelineResult.
     */
    async deploy(request: DeploymentPipelineRequest): Promise<DeploymentPipelineResult> {
        const supabase = createClient();
        const { userId, templateId, customization, name } = request;

        // ── Step 1: Create deployment record ─────────────────────────────────
        const deploymentId = crypto.randomUUID();

        const { error: insertError } = await supabase.from('deployments').insert({
            id: deploymentId,
            user_id: userId,
            template_id: templateId,
            name,
            customization_config: customization as unknown as import('@/lib/supabase/database.types').Json,
            status: 'pending',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        });

        if (insertError) {
            return {
                success: false,
                deploymentId,
                errorMessage: `Failed to create deployment record: ${insertError.message}`,
            };
        }

        await this.log(deploymentId, 'pending', 'Deployment record created', 'info');

        // ── Step 2: Generate code ─────────────────────────────────────────────
        await this.setStatus(deploymentId, 'generating');
        await this.log(deploymentId, 'generating', 'Starting code generation', 'info');

        const generationResult = await this._templateGeneratorService.generate({
            templateId,
            customization,
            outputPath: `/tmp/craft-workspaces/${deploymentId}`,
        });

        if (!generationResult.success) {
            const msg = generationResult.errors.map((e) => e.message).join('; ');
            return this.fail(deploymentId, 'generating', `Code generation failed: ${msg}`);
        }

        await this.log(
            deploymentId,
            'generating',
            `Generated ${generationResult.generatedFiles.length} files`,
            'info',
            { fileCount: generationResult.generatedFiles.length },
        );

        // ── Step 3: Create GitHub repository ─────────────────────────────────
        await this.setStatus(deploymentId, 'creating_repo');
        await this.log(deploymentId, 'creating_repo', 'Creating GitHub repository', 'info');

        let repoFullName: string;
        let repositoryUrl: string;
        let defaultBranch: string;

        try {
            const { repository, resolvedName } = await this._githubService.createRepository({
                name,
                description: `CRAFT deployment — ${name}`,
                private: true,
                userId,
            });

            repoFullName = repository.fullName;
            repositoryUrl = repository.url;
            defaultBranch = repository.defaultBranch;

            await supabase
                .from('deployments')
                .update({
                    repository_url: repositoryUrl,
                    status: 'pushing_code',
                    updated_at: new Date().toISOString(),
                })
                .eq('id', deploymentId);

            await this.log(
                deploymentId,
                'creating_repo',
                `Repository created: ${repoFullName}`,
                'info',
                { repositoryUrl, resolvedName },
            );
        } catch (err: unknown) {
            const svcErr = err as { code?: string; message?: string; retryAfterMs?: number };
            return this.fail(
                deploymentId,
                'creating_repo',
                `GitHub repository creation failed: ${svcErr.message ?? 'unknown error'}`,
                { code: svcErr.code, retryAfterMs: svcErr.retryAfterMs },
            );
        }

        // ── Step 4: Push generated code ───────────────────────────────────────
        await this.setStatus(deploymentId, 'pushing_code');
        await this.log(deploymentId, 'pushing_code', 'Pushing generated code to repository', 'info');

        const githubToken = process.env.GITHUB_TOKEN ?? '';
        const [owner, repo] = repoFullName.split('/');

        try {
            const commitRef = await this._githubPushService.pushGeneratedCode({
                owner,
                repo,
                token: githubToken,
                files: generationResult.generatedFiles,
                branch: defaultBranch,
                commitMessage: 'feat: initial CRAFT deployment',
                authorName: 'CRAFT Platform',
                authorEmail: 'craft@stellercraft.io',
            });

            await this.log(
                deploymentId,
                'pushing_code',
                `Pushed ${commitRef.fileCount} files — commit ${commitRef.commitSha.slice(0, 7)}`,
                'info',
                { commitSha: commitRef.commitSha, fileCount: commitRef.fileCount },
            );
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Unknown push error';
            return this.fail(deploymentId, 'pushing_code', `Code push failed: ${msg}`);
        }

        // ── Step 5 & 6: Create Vercel project + trigger deployment ────────────
        await this.setStatus(deploymentId, 'deploying');
        await this.log(deploymentId, 'deploying', 'Creating Vercel project', 'info');

        // Resolve template family for env var generation
        let templateFamily: TemplateFamilyId = 'stellar-dex';
        try {
            const { data: tmpl } = await supabase
                .from('templates')
                .select('category')
                .eq('id', templateId)
                .single();
            if (tmpl?.category) {
                templateFamily = mapCategoryToFamily(
                    tmpl.category as import('@craft/types').TemplateCategory,
                );
            }
        } catch {
            // Non-fatal — fall back to default family
        }

        const envVars = buildVercelEnvVars(templateFamily, customization);

        let deploymentUrl: string;
        let vercelProjectId: string;
        let vercelDeploymentId: string;

        try {
            const project = await this._vercelService.createProject({
                name: `craft-${repo.toLowerCase()}`,
                gitRepo: repoFullName,
                envVars,
                framework: 'nextjs',
            });

            vercelProjectId = project.id;

            await this.log(
                deploymentId,
                'deploying',
                `Vercel project created: ${project.name}`,
                'info',
                { vercelProjectId },
            );

            const deployment = await this._vercelService.triggerDeployment(
                project.id,
                repoFullName,
            );

            vercelDeploymentId = deployment.deploymentId;
            deploymentUrl = deployment.deploymentUrl;

            await this.log(
                deploymentId,
                'deploying',
                `Vercel deployment triggered: ${deploymentUrl}`,
                'info',
                { vercelDeploymentId, deploymentUrl },
            );
        } catch (err: unknown) {
            const svcErr = err as { code?: string; message?: string };
            return this.fail(
                deploymentId,
                'deploying',
                `Vercel deployment failed: ${svcErr.message ?? 'unknown error'}`,
                { code: svcErr.code },
            );
        }

        // ── Step 7: Persist completed record ──────────────────────────────────
        await supabase
            .from('deployments')
            .update({
                vercel_project_id: vercelProjectId,
                vercel_deployment_id: vercelDeploymentId,
                deployment_url: deploymentUrl,
                status: 'completed',
                deployed_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .eq('id', deploymentId);

        await this.log(
            deploymentId,
            'completed',
            `Deployment complete — ${deploymentUrl}`,
            'info',
            { deploymentUrl },
        );

        return {
            success: true,
            deploymentId,
            repositoryUrl,
            deploymentUrl,
        };
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private async setStatus(
        deploymentId: string,
        status: DeploymentStatusType,
    ): Promise<void> {
        const supabase = createClient();
        await supabase
            .from('deployments')
            .update({ status, updated_at: new Date().toISOString() })
            .eq('id', deploymentId);
    }

    private async log(
        deploymentId: string,
        stage: string,
        message: string,
        level: LogLevel,
        metadata?: Record<string, unknown>,
    ): Promise<void> {
        const supabase = createClient();
        await supabase.from('deployment_logs').insert({
            deployment_id: deploymentId,
            stage,
            message,
            level,
            metadata: metadata ?? null,
            created_at: new Date().toISOString(),
        });
    }

    private async fail(
        deploymentId: string,
        stage: DeploymentStatusType,
        errorMessage: string,
        metadata?: Record<string, unknown>,
    ): Promise<DeploymentPipelineResult> {
        const supabase = createClient();

        await supabase
            .from('deployments')
            .update({
                status: 'failed',
                error_message: errorMessage,
                updated_at: new Date().toISOString(),
            })
            .eq('id', deploymentId);

        await this.log(deploymentId, stage, errorMessage, 'error', metadata);

        return {
            success: false,
            deploymentId,
            errorMessage,
            failedStage: stage,
        };
    }
}

export const deploymentPipelineService = new DeploymentPipelineService();
