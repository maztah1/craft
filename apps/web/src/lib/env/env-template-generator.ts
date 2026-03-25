/**
 * EnvTemplateGenerator
 *
 * Generates `.env.local` and `.env.example` file content for output applications.
 * Separates resolved values (for .env.local) from placeholder stubs (for .env.example),
 * and defines required vs optional variables per template family.
 *
 * Responsibilities:
 *   - Define the canonical env var schema per template family
 *   - Render resolved .env.local content from a validated CustomizationConfig
 *   - Render .env.example with placeholders for secrets that must be set by the user
 *   - Produce a Vercel-compatible EnvironmentVariable[] array for the Vercel API
 *
 * Design doc properties satisfied:
 *   Property 16 — Code Generation Completeness
 *   Property 42 — Configuration-Driven Blockchain Settings
 *
 * Feature: environment-variable-template-generation
 * Issue branch: issue-066-implement-environment-variable-template-generation
 */

import type { CustomizationConfig } from '@craft/types';
import { NETWORK_PASSPHRASE, DEFAULT_HORIZON_URL } from '@/services/code-generator.service';
import type { TemplateFamilyId } from '@/services/code-generator.service';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Vercel deployment target for an environment variable. */
export type VercelEnvTarget = 'production' | 'preview' | 'development';

/** A single environment variable entry with metadata. */
export interface EnvVarEntry {
    key: string;
    value: string;
    /** Whether the app will fail to start without this variable. */
    required: boolean;
    /** Human-readable description for .env.example comments. */
    description: string;
    /** Vercel deployment targets this var should be set on. */
    targets: VercelEnvTarget[];
    /** If true, value is a secret and should be redacted in .env.example. */
    secret: boolean;
}

/** Vercel API-compatible environment variable record. */
export interface VercelEnvVar {
    key: string;
    value: string;
    target: VercelEnvTarget[];
    type: 'plain' | 'secret' | 'encrypted';
}

// ── Placeholder helpers ───────────────────────────────────────────────────────

const SECRET_PLACEHOLDER = 'your-secret-here';

function placeholder(hint: string): string {
    return `your-${hint}-here`;
}

// ── Schema builders ───────────────────────────────────────────────────────────

/**
 * Build the full ordered list of EnvVarEntry records for a given template
 * family and resolved CustomizationConfig.
 *
 * Entries are grouped by concern: branding → stellar → features → secrets.
 * Required entries come before optional ones within each group.
 */
export function buildEnvVarEntries(
    family: TemplateFamilyId,
    cfg: CustomizationConfig
): EnvVarEntry[] {
    const { branding, features, stellar } = cfg;
    const passphrase = NETWORK_PASSPHRASE[stellar.network];
    const horizonUrl = stellar.horizonUrl || DEFAULT_HORIZON_URL[stellar.network];

    const allTargets: VercelEnvTarget[] = ['production', 'preview', 'development'];

    const entries: EnvVarEntry[] = [
        // ── Branding ──────────────────────────────────────────────────────────
        {
            key: 'NEXT_PUBLIC_APP_NAME',
            value: branding.appName,
            required: true,
            description: 'Display name of the application',
            targets: allTargets,
            secret: false,
        },
        {
            key: 'NEXT_PUBLIC_PRIMARY_COLOR',
            value: branding.primaryColor,
            required: true,
            description: 'Primary brand color (hex)',
            targets: allTargets,
            secret: false,
        },
        {
            key: 'NEXT_PUBLIC_SECONDARY_COLOR',
            value: branding.secondaryColor,
            required: true,
            description: 'Secondary brand color (hex)',
            targets: allTargets,
            secret: false,
        },
        {
            key: 'NEXT_PUBLIC_FONT_FAMILY',
            value: branding.fontFamily,
            required: true,
            description: 'Font family used across the UI',
            targets: allTargets,
            secret: false,
        },

        // ── Stellar network ───────────────────────────────────────────────────
        {
            key: 'NEXT_PUBLIC_STELLAR_NETWORK',
            value: stellar.network,
            required: true,
            description: 'Stellar network identifier: mainnet or testnet',
            targets: allTargets,
            secret: false,
        },
        {
            key: 'NEXT_PUBLIC_HORIZON_URL',
            value: horizonUrl,
            required: true,
            description: 'Horizon API endpoint for the selected network',
            targets: allTargets,
            secret: false,
        },
        {
            key: 'NEXT_PUBLIC_NETWORK_PASSPHRASE',
            value: passphrase,
            required: true,
            description: 'Stellar network passphrase used for transaction signing',
            targets: allTargets,
            secret: false,
        },

        // ── Features ──────────────────────────────────────────────────────────
        {
            key: 'NEXT_PUBLIC_ENABLE_CHARTS',
            value: String(features.enableCharts),
            required: false,
            description: 'Enable chart components',
            targets: allTargets,
            secret: false,
        },
        {
            key: 'NEXT_PUBLIC_ENABLE_TRANSACTION_HISTORY',
            value: String(features.enableTransactionHistory),
            required: false,
            description: 'Enable transaction history view',
            targets: allTargets,
            secret: false,
        },
        {
            key: 'NEXT_PUBLIC_ENABLE_ANALYTICS',
            value: String(features.enableAnalytics),
            required: false,
            description: 'Enable analytics tracking',
            targets: allTargets,
            secret: false,
        },
        {
            key: 'NEXT_PUBLIC_ENABLE_NOTIFICATIONS',
            value: String(features.enableNotifications),
            required: false,
            description: 'Enable in-app notifications',
            targets: allTargets,
            secret: false,
        },
    ];

    // ── Soroban RPC (soroban-defi always needs it) ────────────────────────────
    if (stellar.sorobanRpcUrl || family === 'soroban-defi') {
        entries.push({
            key: 'NEXT_PUBLIC_SOROBAN_RPC_URL',
            value: stellar.sorobanRpcUrl ?? 'https://soroban-testnet.stellar.org',
            required: family === 'soroban-defi',
            description: 'Soroban RPC endpoint for smart contract interactions',
            targets: allTargets,
            secret: false,
        });
    }

    // ── Asset pairs (stellar-dex, soroban-defi) ───────────────────────────────
    if (
        (family === 'stellar-dex' || family === 'soroban-defi') &&
        stellar.assetPairs &&
        stellar.assetPairs.length > 0
    ) {
        entries.push({
            key: 'NEXT_PUBLIC_ASSET_PAIRS',
            value: JSON.stringify(stellar.assetPairs),
            required: false,
            description: 'JSON array of trading asset pairs',
            targets: allTargets,
            secret: false,
        });
    }

    // ── Contract addresses (soroban-defi, asset-issuance) ────────────────────
    if (
        (family === 'soroban-defi' || family === 'asset-issuance') &&
        stellar.contractAddresses &&
        Object.keys(stellar.contractAddresses).length > 0
    ) {
        entries.push({
            key: 'NEXT_PUBLIC_CONTRACT_ADDRESSES',
            value: JSON.stringify(stellar.contractAddresses),
            required: false,
            description: 'JSON map of Soroban contract addresses',
            targets: allTargets,
            secret: false,
        });
    }

    // ── Secrets (placeholders — must be set by the user post-deploy) ──────────
    entries.push(
        {
            key: 'NEXT_PUBLIC_APP_URL',
            value: placeholder('app-url'),
            required: true,
            description: 'Public URL of the deployed application (e.g. https://myapp.vercel.app)',
            targets: allTargets,
            secret: false,
        },
        {
            key: 'NEXT_PUBLIC_SUPABASE_URL',
            value: placeholder('supabase-project-url'),
            required: true,
            description: 'Supabase project URL',
            targets: allTargets,
            secret: false,
        },
        {
            key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
            value: placeholder('supabase-anon-key'),
            required: true,
            description: 'Supabase anonymous (public) API key',
            targets: allTargets,
            secret: false,
        },
        {
            key: 'SUPABASE_SERVICE_ROLE_KEY',
            value: SECRET_PLACEHOLDER,
            required: true,
            description: 'Supabase service role key — keep secret, server-side only',
            targets: ['production', 'preview'],
            secret: true,
        }
    );

    return entries;
}

// ── Renderers ─────────────────────────────────────────────────────────────────

/**
 * Render a resolved `.env.local` file from a validated config.
 * All values are concrete — no placeholders.
 * Secrets are included as-is (the user fills them in before deploying).
 */
export function renderEnvLocal(
    family: TemplateFamilyId,
    cfg: CustomizationConfig
): string {
    const entries = buildEnvVarEntries(family, cfg);
    const lines: string[] = [
        `# Auto-generated by CRAFT Platform`,
        `# Template: ${family}`,
        `# Feature: environment-variable-template-generation`,
        `#`,
        `# Fill in the placeholder values before deploying.`,
        `# Never commit this file to version control.`,
        '',
    ];

    let lastGroup = '';
    for (const entry of entries) {
        const group = groupOf(entry.key);
        if (group !== lastGroup) {
            if (lastGroup !== '') lines.push('');
            lines.push(`# ${group}`);
            lastGroup = group;
        }
        lines.push(`# ${entry.description}`);
        if (!entry.required) lines.push(`# Optional`);
        lines.push(`${entry.key}=${entry.value}`);
    }

    return lines.join('\n') + '\n';
}

/**
 * Render a `.env.example` file with placeholders for secrets.
 * Safe to commit to version control — no real secrets included.
 */
export function renderEnvExample(
    family: TemplateFamilyId,
    cfg: CustomizationConfig
): string {
    const entries = buildEnvVarEntries(family, cfg);
    const lines: string[] = [
        `# Auto-generated by CRAFT Platform`,
        `# Template: ${family}`,
        `# Feature: environment-variable-template-generation`,
        `#`,
        `# Copy this file to .env.local and fill in the values.`,
        `# Lines marked [SECRET] must never be committed with real values.`,
        '',
    ];

    let lastGroup = '';
    for (const entry of entries) {
        const group = groupOf(entry.key);
        if (group !== lastGroup) {
            if (lastGroup !== '') lines.push('');
            lines.push(`# ${group}`);
            lastGroup = group;
        }
        const secretTag = entry.secret ? ' [SECRET]' : '';
        const requiredTag = entry.required ? ' [REQUIRED]' : ' [OPTIONAL]';
        lines.push(`# ${entry.description}${requiredTag}${secretTag}`);
        // Secrets get a generic placeholder; public vars show the resolved value as a hint
        const displayValue = entry.secret ? SECRET_PLACEHOLDER : entry.value;
        lines.push(`${entry.key}=${displayValue}`);
    }

    return lines.join('\n') + '\n';
}

/**
 * Produce a Vercel API-compatible EnvironmentVariable[] array.
 * Secrets are typed as 'encrypted'; public vars as 'plain'.
 */
export function buildVercelEnvVars(
    family: TemplateFamilyId,
    cfg: CustomizationConfig
): VercelEnvVar[] {
    return buildEnvVarEntries(family, cfg).map((entry) => ({
        key: entry.key,
        value: entry.value,
        target: entry.targets,
        type: entry.secret ? 'encrypted' : 'plain',
    }));
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Map an env var key to a human-readable group label for section comments.
 */
function groupOf(key: string): string {
    if (key.startsWith('NEXT_PUBLIC_APP_NAME') || key.startsWith('NEXT_PUBLIC_PRIMARY') ||
        key.startsWith('NEXT_PUBLIC_SECONDARY') || key.startsWith('NEXT_PUBLIC_FONT')) {
        return 'Branding';
    }
    if (key.startsWith('NEXT_PUBLIC_STELLAR') || key.startsWith('NEXT_PUBLIC_HORIZON') ||
        key.startsWith('NEXT_PUBLIC_NETWORK') || key.startsWith('NEXT_PUBLIC_SOROBAN') ||
        key.startsWith('NEXT_PUBLIC_ASSET') || key.startsWith('NEXT_PUBLIC_CONTRACT')) {
        return 'Stellar';
    }
    if (key.startsWith('NEXT_PUBLIC_ENABLE')) {
        return 'Features';
    }
    if (key.startsWith('NEXT_PUBLIC_SUPABASE') || key.startsWith('SUPABASE')) {
        return 'Supabase';
    }
    if (key.startsWith('NEXT_PUBLIC_APP_URL')) {
        return 'App';
    }
    return 'Other';
}
