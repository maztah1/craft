import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalizeDraftConfig, CustomizationDraftService } from './customization-draft.service';

// --- Supabase mock chain (must be at module scope for vi.mock hoisting) ---
const mockSingle = vi.fn();
const mockSelect = vi.fn(() => ({ single: mockSingle }));
const mockEq = vi.fn(() => ({ eq: mockEq, single: mockSingle, select: mockSelect }));
const mockUpsert = vi.fn(() => ({ select: mockSelect }));
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({ from: mockFrom }),
}));

// --- Test fixtures ---
const fakeUser = { id: 'user-1' };
const templateId = 'tmpl-1';
const deploymentId = 'dep-1';

const validConfig = {
    branding: { appName: 'DEX', primaryColor: '#f00', secondaryColor: '#0f0', fontFamily: 'Inter' },
    features: { enableCharts: true, enableTransactionHistory: true, enableAnalytics: false, enableNotifications: false },
    stellar: { network: 'testnet', horizonUrl: 'https://horizon-testnet.stellar.org' },
};

const fakeRow = {
    id: 'draft-1',
    user_id: fakeUser.id,
    template_id: templateId,
    customization_config: validConfig,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
};

const full = {
    branding: { appName: 'DEX', primaryColor: '#f00', secondaryColor: '#0f0', fontFamily: 'Mono' },
    features: { enableCharts: false, enableTransactionHistory: false, enableAnalytics: true, enableNotifications: true },
    stellar: { network: 'mainnet', horizonUrl: 'https://horizon.stellar.org' },
};

beforeEach(() => vi.clearAllMocks());

describe('normalizeDraftConfig', () => {
    it('returns full config unchanged', () => {
        const result = normalizeDraftConfig(full);
        expect(result.branding.appName).toBe('DEX');
        expect(result.stellar.network).toBe('mainnet');
    });

    it('fills missing branding fields with defaults', () => {
        const result = normalizeDraftConfig({ branding: { appName: 'X' }, features: full.features, stellar: full.stellar });
        expect(result.branding.primaryColor).toBe('#6366f1');
        expect(result.branding.appName).toBe('X');
    });

    it('fills missing features with defaults', () => {
        const result = normalizeDraftConfig({ branding: full.branding, stellar: full.stellar });
        expect(result.features.enableCharts).toBe(true);
    });

    it('fills missing stellar with defaults', () => {
        const result = normalizeDraftConfig({ branding: full.branding, features: full.features });
        expect(result.stellar.network).toBe('testnet');
        expect(result.stellar.horizonUrl).toBe('https://horizon-testnet.stellar.org');
    });

    it('handles null/undefined input gracefully', () => {
        const result = normalizeDraftConfig(null);
        expect(result.branding.fontFamily).toBe('Inter');
        expect(result.features.enableCharts).toBe(true);
    });

    it('handles completely empty object', () => {
        const result = normalizeDraftConfig({});
        expect(result.stellar.network).toBe('testnet');
    });
});

describe('saveDraft', () => {
    const service = new CustomizationDraftService();

    it('returns a CustomizationDraft on success', async () => {
        // Template lookup succeeds
        mockFrom.mockImplementation((table: string) => {
            if (table === 'templates') return { select: () => ({ eq: mockEq }) };
            if (table === 'customization_drafts') return { upsert: mockUpsert };
        });
        mockEq.mockReturnValue({ eq: mockEq, single: mockSingle, select: mockSelect });
        mockSingle.mockResolvedValue({ data: { id: templateId }, error: null });
        // After template lookup, upsert single returns fakeRow
        mockSingle
            .mockResolvedValueOnce({ data: { id: templateId }, error: null }) // template lookup
            .mockResolvedValueOnce({ data: fakeRow, error: null }); // upsert

        const result = await service.saveDraft(fakeUser.id, templateId, validConfig);

        expect(result.id).toBe(fakeRow.id);
        expect(result.userId).toBe(fakeUser.id);
        expect(result.templateId).toBe(templateId);
        expect(result.customizationConfig).toEqual(normalizeDraftConfig(validConfig));
    });

    it("throws 'Template not found' when template lookup returns an error", async () => {
        mockFrom.mockImplementation((table: string) => {
            if (table === 'templates') return { select: () => ({ eq: mockEq }) };
        });
        mockEq.mockReturnValue({ eq: mockEq, single: mockSingle, select: mockSelect });
        mockSingle.mockResolvedValue({ data: null, error: { message: 'not found' } });

        await expect(service.saveDraft(fakeUser.id, templateId, validConfig)).rejects.toThrow('Template not found');
    });

    it("throws 'Failed to save draft: ...' when upsert errors", async () => {
        mockFrom.mockImplementation((table: string) => {
            if (table === 'templates') return { select: () => ({ eq: mockEq }) };
            if (table === 'customization_drafts') return { upsert: mockUpsert };
        });
        mockEq.mockReturnValue({ eq: mockEq, single: mockSingle, select: mockSelect });
        mockSingle
            .mockResolvedValueOnce({ data: { id: templateId }, error: null }) // template lookup succeeds
            .mockResolvedValueOnce({ data: null, error: { message: 'db error' } }); // upsert fails

        await expect(service.saveDraft(fakeUser.id, templateId, validConfig)).rejects.toThrow('Failed to save draft: db error');
    });

    it("passes onConflict: 'user_id,template_id' to upsert", async () => {
        mockFrom.mockImplementation((table: string) => {
            if (table === 'templates') return { select: () => ({ eq: mockEq }) };
            if (table === 'customization_drafts') return { upsert: mockUpsert };
        });
        mockEq.mockReturnValue({ eq: mockEq, single: mockSingle, select: mockSelect });
        mockSingle
            .mockResolvedValueOnce({ data: { id: templateId }, error: null })
            .mockResolvedValueOnce({ data: fakeRow, error: null });

        await service.saveDraft(fakeUser.id, templateId, validConfig);

        expect(mockUpsert).toHaveBeenCalledWith(
            expect.any(Object),
            { onConflict: 'user_id,template_id' }
        );
    });
});

describe('getDraft', () => {
    const service = new CustomizationDraftService();

    it('returns normalized draft when row exists', async () => {
        mockFrom.mockReturnValue({ select: () => ({ eq: mockEq }) });
        mockEq.mockReturnValue({ eq: mockEq, single: mockSingle, select: mockSelect });
        mockSingle.mockResolvedValue({ data: fakeRow, error: null });

        const result = await service.getDraft(fakeUser.id, templateId);

        expect(result).not.toBeNull();
        expect(result!.customizationConfig).toEqual(normalizeDraftConfig(fakeRow.customization_config));
    });

    it('returns null on PGRST116 error', async () => {
        mockFrom.mockReturnValue({ select: () => ({ eq: mockEq }) });
        mockEq.mockReturnValue({ eq: mockEq, single: mockSingle, select: mockSelect });
        mockSingle.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });

        const result = await service.getDraft(fakeUser.id, templateId);

        expect(result).toBeNull();
    });

    it("throws 'Failed to get draft: ...' on other errors", async () => {
        mockFrom.mockReturnValue({ select: () => ({ eq: mockEq }) });
        mockEq.mockReturnValue({ eq: mockEq, single: mockSingle, select: mockSelect });
        mockSingle.mockResolvedValue({ data: null, error: { code: 'OTHER', message: 'boom' } });

        await expect(service.getDraft(fakeUser.id, templateId)).rejects.toThrow('Failed to get draft: boom');
    });
});

describe('getDraftByDeployment', () => {
    const service = new CustomizationDraftService();

    it("throws 'Forbidden' when deployment user_id mismatches", async () => {
        mockFrom.mockReturnValue({ select: () => ({ eq: mockEq }) });
        mockEq.mockReturnValue({ eq: mockEq, single: mockSingle, select: mockSelect });
        mockSingle.mockResolvedValue({
            data: { template_id: templateId, user_id: 'other-user' },
            error: null,
        });

        await expect(service.getDraftByDeployment(fakeUser.id, deploymentId)).rejects.toThrow('Forbidden');
    });

    it('returns null when deployment not found', async () => {
        mockFrom.mockReturnValue({ select: () => ({ eq: mockEq }) });
        mockEq.mockReturnValue({ eq: mockEq, single: mockSingle, select: mockSelect });
        mockSingle.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });

        const result = await service.getDraftByDeployment(fakeUser.id, deploymentId);

        expect(result).toBeNull();
    });
});
