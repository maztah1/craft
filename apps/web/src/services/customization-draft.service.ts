import { createClient } from '@/lib/supabase/server';
import type { CustomizationConfig } from '@craft/types';

const DEFAULT_CONFIG: CustomizationConfig = {
    branding: {
        appName: '',
        primaryColor: '#6366f1',
        secondaryColor: '#a5b4fc',
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

/**
 * Deep-merge persisted JSONB with defaults so partial/stale drafts are always
 * safe to hand to the UI without crashing on missing fields.
 */
export function normalizeDraftConfig(raw: unknown): CustomizationConfig {
    const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
    return {
        branding: { ...DEFAULT_CONFIG.branding, ...(src.branding ?? {}) },
        features: { ...DEFAULT_CONFIG.features, ...(src.features ?? {}) },
        stellar: { ...DEFAULT_CONFIG.stellar, ...(src.stellar ?? {}) },
    };
}

export interface CustomizationDraft {
    id: string;
    userId: string;
    templateId: string;
    customizationConfig: CustomizationConfig;
    createdAt: Date;
    updatedAt: Date;
}

export class CustomizationDraftService {
    /**
     * Save (create or overwrite) a customization draft for a user+template pair.
     * Only one draft per user per template is kept.
     */
    async saveDraft(
        userId: string,
        templateId: string,
        config: CustomizationConfig
    ): Promise<CustomizationDraft> {
        const supabase = createClient();

        // Verify the template exists and is active
        const { data: template, error: templateError } = await supabase
            .from('templates')
            .select('id')
            .eq('id', templateId)
            .eq('is_active', true)
            .single();

        if (templateError || !template) {
            throw new Error('Template not found');
        }

        const { data, error } = await supabase
            .from('customization_drafts')
            .upsert(
                {
                    user_id: userId,
                    template_id: templateId,
                    customization_config: config as any,
                    updated_at: new Date().toISOString(),
                },
                { onConflict: 'user_id,template_id' }
            )
            .select()
            .single();

        if (error) {
            throw new Error(`Failed to save draft: ${error.message}`);
        }

        return this.mapRow(data);
    }

    /**
     * Get the saved draft for a user+template pair, or null if none exists.
     */
    async getDraft(
        userId: string,
        templateId: string
    ): Promise<CustomizationDraft | null> {
        const supabase = createClient();

        const { data, error } = await supabase
            .from('customization_drafts')
            .select('*')
            .eq('user_id', userId)
            .eq('template_id', templateId)
            .single();

        if (error?.code === 'PGRST116') return null; // no rows
        if (error) throw new Error(`Failed to get draft: ${error.message}`);

        return data ? this.mapRow(data) : null;
    }

    /**
     * Load a draft via deployment context — resolves the template from the
     * deployment, then delegates to getDraft. Returns null if no draft exists.
     */
    async getDraftByDeployment(
        userId: string,
        deploymentId: string
    ): Promise<CustomizationDraft | null> {
        const supabase = createClient();

        const { data: deployment, error } = await supabase
            .from('deployments')
            .select('template_id, user_id')
            .eq('id', deploymentId)
            .single();

        if (error?.code === 'PGRST116') return null;
        if (error) throw new Error(`Failed to load deployment: ${error.message}`);
        if (!deployment) return null;
        if (deployment.user_id !== userId) throw new Error('Forbidden');

        return this.getDraft(userId, deployment.template_id);
    }

    private mapRow(row: any): CustomizationDraft {
        return {
            id: row.id,
            userId: row.user_id,
            templateId: row.template_id,
            customizationConfig: normalizeDraftConfig(row.customization_config),
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
        };
    }
}

export const customizationDraftService = new CustomizationDraftService();
