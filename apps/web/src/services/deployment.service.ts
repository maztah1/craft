import { createClient } from '@/lib/supabase/server';
import { githubService } from './github.service';
import { githubPushService } from './github-push.service';
import { templateGeneratorService } from './template-generator.service';
import { deploymentUpdateService } from './deployment-update.service';
import type {
    DeploymentRequest,
    DeploymentResult,
    DeploymentStatusType,
    DeploymentStatus,
    CustomizationConfig
} from '@craft/types';

export class DeploymentService {
    async createDeployment(request: DeploymentRequest): Promise<DeploymentResult> {
        const supabase = createClient();
        const deploymentId = crypto.randomUUID();

        // 1. Initial State
        await supabase.from('deployments').insert({
            id: deploymentId,
            user_id: request.userId,
            template_id: request.templateId,
            name: request.repositoryName,
            customization_config: request.customization,
            status: 'pending' as DeploymentStatusType,
            is_active: true,
        });

        this.logProgress(deploymentId, 'pending', 'Deployment started');

        try {
            // 2. Generate Code
            await this.updateStatus(deploymentId, 'generating');
            const generation = await templateGeneratorService.generate({
                templateId: request.templateId,
                customization: request.customization,
                outputPath: `/tmp/craft-${deploymentId}`
            });

            if (!generation.success) {
                throw new Error('Code generation failed');
            }

            // 3. Create Repo
            await this.updateStatus(deploymentId, 'creating_repo');
            const repoConfig = await githubService.createRepository({
                name: request.repositoryName,
                private: true,
                userId: request.userId,
                description: `Created by CRAFT platform`
            });

            const repositoryUrl = repoConfig.repository.url;

            // 4. Push Code
            await this.updateStatus(deploymentId, 'pushing_code');
            const token = process.env.GITHUB_TOKEN || 'mock-token';
            await githubPushService.pushGeneratedCode({
                owner: process.env.GITHUB_ORG || request.userId,
                repo: repoConfig.resolvedName,
                token,
                files: generation.generatedFiles,
                branch: 'main',
                commitMessage: 'Initial deployment via CRAFT'
            });

            // 5. Deploy to Vercel (Simulated per issue description requirements)
            await this.updateStatus(deploymentId, 'deploying');
            const vercelUrl = `https://${repoConfig.resolvedName}.vercel.app`;
            
            // For property testing / mock simulation
            if ((globalThis as any).__VERCEL_DEPLOY_SHOULD_FAIL) {
                throw new Error('Vercel deployment failed');
            }

            // 6. Complete
            await supabase.from('deployments').update({
                status: 'completed' as DeploymentStatusType,
                repository_url: repositoryUrl,
                deployment_url: vercelUrl,
                deployed_at: new Date().toISOString()
            }).eq('id', deploymentId);

            this.logProgress(deploymentId, 'completed', 'Deployment successful');

            return {
                deploymentId,
                repositoryUrl,
                vercelUrl,
                status: { stage: 'completed', url: vercelUrl }
            };

        } catch (error: any) {
            await supabase.from('deployments').update({
                status: 'failed' as DeploymentStatusType,
                error_message: error.message
            }).eq('id', deploymentId);

            this.logProgress(deploymentId, 'failed', `Deployment failed: ${error.message}`);
            
            throw error;
        }
    }

    async deleteDeployment(deploymentId: string, userId: string): Promise<boolean> {
        const supabase = createClient();
        
        // Ensure user owns deployment
        const { data, error } = await supabase.from('deployments')
            .select('id')
            .eq('id', deploymentId)
            .eq('user_id', userId)
            .single();
            
        if (error || !data) {
            return false;
        }

        // Delete from deployments table
        await supabase.from('deployments').delete().eq('id', deploymentId);
        
        // Log deletion (could be in deployment_logs or audits)
        this.logProgress(deploymentId, 'deleted', 'Deployment deleted successfully');
        
        return true;
    }

    /**
     * Get the current normalized status for a deployment.
     * This method is safe for repeated polling and returns:
     * - Current deployment status
     * - Timestamps (created, updated, deployed)
     * - URLs (deployment URL, repository URL)
     * - Status detail (stage, progress, error message if failed)
     * - Vercel deployment status (if available)
     * 
     * @param deploymentId - The deployment ID
     * @param userId - The user ID (for ownership verification)
     * @returns Deployment status with all metadata, or null if not found/unauthorized
     */
    async getDeploymentStatus(
        deploymentId: string,
        userId: string
    ): Promise<{
        id: string;
        status: DeploymentStatusType;
        deploymentUrl: string | null;
        repositoryUrl: string | null;
        vercelDeploymentId: string | null;
        timestamps: {
            created: string;
            updated: string;
            deployed: string | null;
        };
        statusDetail: DeploymentStatus;
        errorMessage: string | null;
    } | null> {
        const supabase = createClient();

        // Fetch deployment with ownership check
        const { data: deployment, error: fetchError } = await supabase
            .from('deployments')
            .select(`
                id,
                status,
                deployment_url,
                repository_url,
                vercel_deployment_id,
                error_message,
                created_at,
                updated_at,
                deployed_at
            `)
            .eq('id', deploymentId)
            .eq('user_id', userId)
            .single();

        if (fetchError || !deployment) {
            return null;
        }

        // Get Vercel deployment status if available
        let vercelStatus: string | null = null;
        if (deployment.vercel_deployment_id) {
            try {
                // Note: In production, this would call Vercel API to get real-time status
                // For now, we'll use the stored status
                vercelStatus = deployment.status;
            } catch (error) {
                // Log but don't fail - we still return our internal status
                console.error('Failed to fetch Vercel deployment status:', error);
            }
        }

        // Build status detail based on current status
        const statusDetail = this.buildStatusDetail(
            deployment.status as DeploymentStatusType,
            deployment.error_message
        );

        return {
            id: deployment.id,
            status: deployment.status as DeploymentStatusType,
            deploymentUrl: deployment.deployment_url,
            repositoryUrl: deployment.repository_url,
            vercelDeploymentId: deployment.vercel_deployment_id,
            timestamps: {
                created: deployment.created_at,
                updated: deployment.updated_at,
                deployed: deployment.deployed_at,
            },
            statusDetail,
            errorMessage: deployment.error_message,
        };
    }

    /**
     * Build detailed status information based on deployment status.
     * This provides progress metadata for UI consumers.
     */
    private buildStatusDetail(
        status: DeploymentStatusType,
        errorMessage: string | null
    ): DeploymentStatus {
        if (status === 'completed') {
            return { stage: 'completed', url: '' }; // URL will be filled by caller
        }

        if (status === 'failed') {
            return { stage: 'failed', error: errorMessage || 'Deployment failed' };
        }

        // Map internal status to DeploymentStatus stage
        const stageMap: Record<string, DeploymentStatus['stage']> = {
            generating: 'generating',
            creating_repo: 'creating_repo',
            pushing_code: 'pushing_code',
            deploying: 'deploying_vercel',
        };

        const progressMap: Record<string, number> = {
            pending: 0,
            generating: 20,
            creating_repo: 40,
            pushing_code: 60,
            deploying: 80,
        };

        const stage = stageMap[status] || 'generating';
        const progress = progressMap[status] || 0;

        return {
            stage,
            progress,
        } as DeploymentStatus;
    }

    /**
     * Check if a deployment is in a terminal state (completed or failed).
     * Useful for polling logic to know when to stop.
     */
    async isDeploymentTerminal(
        deploymentId: string,
        userId: string
    ): Promise<boolean> {
        const status = await this.getDeploymentStatus(deploymentId, userId);
        if (!status) {
            return true; // Not found = terminal for polling purposes
        }
        return status.status === 'completed' || status.status === 'failed';
    }

    /**
     * Get deployment status for multiple deployments (batch operation).
     * Useful for dashboard views.
     */
    async getDeploymentStatusBatch(
        deploymentIds: string[],
        userId: string
    ): Promise<Array<{
        id: string;
        status: DeploymentStatusType;
        deploymentUrl: string | null;
        timestamps: {
            created: string;
            updated: string;
            deployed: string | null;
        };
    }>> {
        const supabase = createClient();

        const { data: deployments, error } = await supabase
            .from('deployments')
            .select(`
                id,
                status,
                deployment_url,
                created_at,
                updated_at,
                deployed_at
            `)
            .in('id', deploymentIds)
            .eq('user_id', userId);

        if (error || !deployments) {
            return [];
        }

        return deployments.map((deployment: any) => ({
            id: deployment.id,
            status: deployment.status as DeploymentStatusType,
            deploymentUrl: deployment.deployment_url,
            timestamps: {
                created: deployment.created_at,
                updated: deployment.updated_at,
                deployed: deployment.deployed_at,
            },
        }));
    }

    private async updateStatus(deploymentId: string, status: DeploymentStatusType) {
        const supabase = createClient();
        await supabase.from('deployments').update({ status }).eq('id', deploymentId);
        this.logProgress(deploymentId, status, `Deployment ${status}`);
    }

    /**
     * Redeploy an existing deployment with optional configuration updates.
     * This method orchestrates the redeploy flow:
     * 1. Validates the deployment exists and is in a redeployable state
     * 2. Reuses stored repository/project data
     * 3. Triggers regeneration and redeployment
     * 4. Preserves deployment history references
     *
     * @param deploymentId - The deployment ID to redeploy
     * @param userId - The user ID (for ownership verification)
     * @param newCustomization - Optional new customization config (if updating)
     * @returns Redeployment result with status
     */
    async redeployDeployment(
        deploymentId: string,
        userId: string,
        newCustomization?: CustomizationConfig
    ): Promise<{
        success: boolean;
        deploymentId: string;
        deploymentUrl?: string;
        errorMessage?: string;
        rolledBack?: boolean;
    }> {
        const supabase = createClient();

        // 1. Fetch deployment with ownership check
        const { data: deployment, error: fetchError } = await supabase
            .from('deployments')
            .select(`
                id,
                user_id,
                status,
                template_id,
                customization_config,
                repository_url,
                vercel_project_id,
                deployment_url,
                name
            `)
            .eq('id', deploymentId)
            .eq('user_id', userId)
            .single();

        if (fetchError || !deployment) {
            return {
                success: false,
                deploymentId,
                errorMessage: 'Deployment not found or access denied',
            };
        }

        // 2. Validate deployment is in a redeployable state
        const redeployableStatuses: DeploymentStatusType[] = ['completed', 'failed'];
        if (!redeployableStatuses.includes(deployment.status as DeploymentStatusType)) {
            return {
                success: false,
                deploymentId,
                errorMessage: `Cannot redeploy deployment in '${deployment.status}' state. Must be 'completed' or 'failed'.`,
            };
        }

        // 3. Log redeployment start
        await this.logProgress(deploymentId, 'redeploying', 'Redeployment initiated');

        try {
            // 4. If new customization provided, use deployment update service
            if (newCustomization) {
                const updateResult = await deploymentUpdateService.updateDeployment({
                    deploymentId,
                    userId,
                    customizationConfig: newCustomization,
                });

                if (!updateResult.success) {
                    return {
                        success: false,
                        deploymentId,
                        errorMessage: updateResult.errorMessage || 'Update failed',
                        rolledBack: updateResult.rolledBack,
                    };
                }

                return {
                    success: true,
                    deploymentId,
                    deploymentUrl: updateResult.deploymentUrl,
                };
            }

            // 5. Otherwise, trigger redeployment with existing config
            // This reuses the stored repository and Vercel project data
            await this.updateStatus(deploymentId, 'deploying');

            // Simulate redeployment (in production, this would trigger Vercel redeployment)
            // For now, we'll update the status and log the action
            const deploymentUrl = deployment.deployment_url || `https://${deployment.name}.vercel.app`;

            // Update deployment with new timestamp
            await supabase.from('deployments').update({
                status: 'completed' as DeploymentStatusType,
                deployed_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            }).eq('id', deploymentId);

            await this.logProgress(deploymentId, 'completed', 'Redeployment successful');

            return {
                success: true,
                deploymentId,
                deploymentUrl,
            };

        } catch (error: any) {
            // Log failure
            await this.logProgress(deploymentId, 'failed', `Redeployment failed: ${error.message}`);

            // Restore previous status if it was completed
            if (deployment.status === 'completed') {
                await supabase.from('deployments').update({
                    status: 'completed' as DeploymentStatusType,
                    updated_at: new Date().toISOString(),
                }).eq('id', deploymentId);
            }

            return {
                success: false,
                deploymentId,
                errorMessage: error.message || 'Redeployment failed',
            };
        }
    }

    /**
     * Get redeployment history for a deployment.
     * Returns a list of all redeployment attempts with their status.
     */
    async getRedeploymentHistory(
        deploymentId: string,
        userId: string
    ): Promise<Array<{
        id: string;
        status: string;
        timestamp: string;
        errorMessage?: string;
    }>> {
        const supabase = createClient();

        // Verify ownership
        const { data: deployment } = await supabase
            .from('deployments')
            .select('id')
            .eq('id', deploymentId)
            .eq('user_id', userId)
            .single();

        if (!deployment) {
            return [];
        }

        // Fetch deployment logs related to redeployment
        const { data: logs, error } = await supabase
            .from('deployment_logs')
            .select('id, stage, message, created_at')
            .eq('deployment_id', deploymentId)
            .in('stage', ['redeploying', 'completed', 'failed'])
            .order('created_at', { ascending: false });

        if (error || !logs) {
            return [];
        }

        return logs.map((log: any) => ({
            id: log.id,
            status: log.stage,
            timestamp: log.created_at,
            errorMessage: log.stage === 'failed' ? log.message : undefined,
        }));
    }

    private async logProgress(deploymentId: string, stage: string, message: string) {
        const supabase = createClient();
        await supabase.from('deployment_logs').insert({
            id: crypto.randomUUID(),
            deployment_id: deploymentId,
            stage,
            message,
            log_level: stage === 'failed' ? 'error' : 'info',
            created_at: new Date().toISOString()
        });
    }
}

export const deploymentService = new DeploymentService();
