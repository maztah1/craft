/**
 * Subscription tier guard for custom domain operations.
 *
 * Custom domains are available on the **pro** and **enterprise** tiers only
 * (`maxCustomDomains > 0`). Free-tier users receive a 403 with an upgrade
 * prompt so the client can surface a meaningful call-to-action.
 *
 * Usage (inside a `withDeploymentAuth` handler):
 *
 *   const denied = await requireDomainTier(supabase, user.id);
 *   if (denied) return denied;
 */

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getEntitlements } from '@/lib/stripe/pricing';
import type { SubscriptionTier } from '@craft/types';

/**
 * Returns a 403 NextResponse when the user's tier does not include custom
 * domain support, or `null` when access is permitted.
 */
export async function requireDomainTier(
  supabase: SupabaseClient,
  userId: string,
): Promise<NextResponse | null> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier')
    .eq('id', userId)
    .single();

  const tier = (profile?.subscription_tier ?? 'free') as SubscriptionTier;
  const { maxCustomDomains } = getEntitlements(tier);

  if (maxCustomDomains === 0) {
    return NextResponse.json(
      {
        error: 'Custom domains require a Pro or Enterprise subscription.',
        requiredTier: 'pro',
        upgradeUrl: '/pricing',
      },
      { status: 403 },
    );
  }

  return null;
}
