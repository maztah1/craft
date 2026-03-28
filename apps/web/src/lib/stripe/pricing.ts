/**
 * Subscription tier definitions and Stripe price/product configuration.
 *
 * This is the single source of truth for:
 *   - Per-tier entitlements and limits
 *   - Stripe price ID → tier mapping (read from env at startup)
 *
 * Entitlements
 * ────────────
 * free        : 1 deployment, no analytics, no custom domains
 * pro         : 10 deployments, analytics, 1 custom domain
 * enterprise  : unlimited deployments, analytics, unlimited custom domains
 *
 * Environment variables required (non-free tiers):
 *   NEXT_PUBLIC_STRIPE_PRICE_PRO          Stripe price ID for the Pro plan
 *   NEXT_PUBLIC_STRIPE_PRICE_ENTERPRISE   Stripe price ID for the Enterprise plan
 *
 * Local development
 * ─────────────────
 * Set SKIP_PRICING_VALIDATION=true to bypass the startup env check.
 * This is set automatically in test environments.
 */

import type { SubscriptionTier } from '@craft/types';

// ── Entitlements ─────────────────────────────────────────────────────────────

export interface TierEntitlements {
  /** Maximum number of active deployments. -1 = unlimited. */
  maxDeployments: number;
  /** Whether the tier includes deployment analytics. */
  analyticsEnabled: boolean;
  /** Maximum number of custom domains per deployment. -1 = unlimited. */
  maxCustomDomains: number;
  /** Whether the tier can access premium templates. */
  premiumTemplates: boolean;
  /** Priority support access. */
  prioritySupport: boolean;
}

export interface TierConfig {
  tier: SubscriptionTier;
  /** Human-readable display name. */
  displayName: string;
  /** Monthly price in USD cents (0 = free). */
  monthlyPriceCents: number;
  entitlements: TierEntitlements;
  /**
   * Stripe price ID for this tier.
   * Resolved from environment variables at module load time.
   * null for the free tier (no Stripe product needed).
   */
  stripePriceId: string | null;
}

export const TIER_CONFIGS: Record<SubscriptionTier, TierConfig> = {
  free: {
    tier: 'free',
    displayName: 'Free',
    monthlyPriceCents: 0,
    entitlements: {
      maxDeployments: 1,
      analyticsEnabled: false,
      maxCustomDomains: 0,
      premiumTemplates: false,
      prioritySupport: false,
    },
    stripePriceId: null,
  },
  pro: {
    tier: 'pro',
    displayName: 'Pro',
    monthlyPriceCents: 2900, // $29/month
    entitlements: {
      maxDeployments: 10,
      analyticsEnabled: true,
      maxCustomDomains: 1,
      premiumTemplates: true,
      prioritySupport: false,
    },
    stripePriceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO ?? null,
  },
  enterprise: {
    tier: 'enterprise',
    displayName: 'Enterprise',
    monthlyPriceCents: 9900, // $99/month
    entitlements: {
      maxDeployments: -1,
      analyticsEnabled: true,
      maxCustomDomains: -1,
      premiumTemplates: true,
      prioritySupport: true,
    },
    stripePriceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_ENTERPRISE ?? null,
  },
};

// ── Lookup helpers ────────────────────────────────────────────────────────────

/**
 * Returns the tier config for a given Stripe price ID.
 * Returns null if the price ID is not mapped to any tier.
 */
export function getTierByPriceId(priceId: string): TierConfig | null {
  return (
    Object.values(TIER_CONFIGS).find(
      (c) => c.stripePriceId !== null && c.stripePriceId === priceId
    ) ?? null
  );
}

/**
 * Returns the SubscriptionTier for a given Stripe price ID.
 * Falls back to 'free' if the price ID is unrecognised.
 */
export function getTierFromPriceId(priceId: string): SubscriptionTier {
  return getTierByPriceId(priceId)?.tier ?? 'free';
}

/**
 * Returns all Stripe price IDs that are valid for checkout.
 * (i.e. paid tiers with a configured price ID)
 */
export function getValidPriceIds(): string[] {
  return Object.values(TIER_CONFIGS)
    .filter((c): c is TierConfig & { stripePriceId: string } => c.stripePriceId !== null)
    .map((c) => c.stripePriceId);
}

/**
 * Returns the entitlements for a given tier.
 */
export function getEntitlements(tier: SubscriptionTier): TierEntitlements {
  return TIER_CONFIGS[tier].entitlements;
}

/**
 * Returns true if the given tier is allowed to configure custom domains.
 * Only pro and enterprise tiers have maxCustomDomains > 0.
 */
export function canConfigureCustomDomain(tier: SubscriptionTier): boolean {
  return TIER_CONFIGS[tier].entitlements.maxCustomDomains !== 0;
}

// ── Startup validation ────────────────────────────────────────────────────────

/**
 * Validates that all required Stripe price IDs are present in the environment.
 * Throws if any paid tier is missing its price ID.
 *
 * Call this once at application startup (e.g. in instrumentation.ts or a
 * server-side initialisation module).
 *
 * Bypass: set SKIP_PRICING_VALIDATION=true (local dev / CI / tests).
 */
export function validatePricingConfig(): void {
  if (process.env.SKIP_PRICING_VALIDATION === 'true') return;

  const missing: string[] = [];

  if (!process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO) {
    missing.push('NEXT_PUBLIC_STRIPE_PRICE_PRO');
  }
  if (!process.env.NEXT_PUBLIC_STRIPE_PRICE_ENTERPRISE) {
    missing.push('NEXT_PUBLIC_STRIPE_PRICE_ENTERPRISE');
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required Stripe pricing environment variables: ${missing.join(', ')}. ` +
        'Set SKIP_PRICING_VALIDATION=true to bypass in local development.'
    );
  }
}
