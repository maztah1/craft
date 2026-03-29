import { describe, it, expect, vi } from 'vitest';
import { requireDomainTier } from './require-domain-tier';

vi.mock('@/lib/stripe/pricing', () => ({
  getEntitlements: vi.fn((tier: string) => {
    if (tier === 'free') return { maxCustomDomains: 0 };
    if (tier === 'pro') return { maxCustomDomains: 1 };
    return { maxCustomDomains: -1 }; // enterprise
  }),
}));

function makeSupabase(tier: string | null) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: tier !== null ? { subscription_tier: tier } : null,
            error: null,
          }),
        })),
      })),
    })),
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

describe('requireDomainTier', () => {
  it('returns null for pro tier', async () => {
    const result = await requireDomainTier(makeSupabase('pro'), 'user-1');
    expect(result).toBeNull();
  });

  it('returns null for enterprise tier', async () => {
    const result = await requireDomainTier(makeSupabase('enterprise'), 'user-1');
    expect(result).toBeNull();
  });

  it('returns 403 for free tier', async () => {
    const result = await requireDomainTier(makeSupabase('free'), 'user-1');
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
    const body = await result!.json();
    expect(body.requiredTier).toBe('pro');
    expect(body.upgradeUrl).toBe('/pricing');
  });

  it('returns 403 when profile is missing (defaults to free)', async () => {
    const result = await requireDomainTier(makeSupabase(null), 'user-1');
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });
});
