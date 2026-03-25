import { z } from 'zod';
import type { CustomizationConfig, ValidationResult, ValidationError } from '@craft/types';
import { validateContractAddresses } from '@/lib/stellar/contract-validation';
import {
    checkStellarEndpoints,
    type ConnectivityCheckResult,
    type ConnectivityErrorType,
} from '@/lib/stellar/endpoint-connectivity';

// ── Zod schema (single source of truth) ──────────────────────────────────────

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Zod schema for customization config validation.
 * Note: Network validators are intentionally lenient here; detailed validation
 * is performed in businessRuleErrors using the StellarNetworkService.
 */
export const customizationConfigSchema = z.object({
    branding: z.object({
        appName: z.string().min(1, 'App name is required').max(60, 'App name must be 60 characters or fewer'),
        logoUrl: z.string().url('Logo URL must be a valid URL').optional(),
        primaryColor: z.string().regex(HEX_COLOR, 'Primary color must be a valid hex color'),
        secondaryColor: z.string().regex(HEX_COLOR, 'Secondary color must be a valid hex color'),
        fontFamily: z.string().min(1, 'Font family is required'),
    }),
    features: z.object({
        enableCharts: z.boolean(),
        enableTransactionHistory: z.boolean(),
        enableAnalytics: z.boolean(),
        enableNotifications: z.boolean(),
    }),
    stellar: z.object({
        // Use unknown to allow detailed validation in businessRuleErrors
        network: z.unknown(),
        horizonUrl: z.string().url('Horizon URL must be a valid URL'),
        sorobanRpcUrl: z.string().url('Soroban RPC URL must be a valid URL').optional(),
        assetPairs: z.array(z.any()).optional(),
        contractAddresses: z.record(z.string()).optional(),
    }),
});

// ── Business rules ────────────────────────────────────────────────────────────

const MAINNET_HORIZON = 'https://horizon.stellar.org';
const TESTNET_HORIZON = 'https://horizon-testnet.stellar.org';

function businessRuleErrors(config: CustomizationConfig): ValidationError[] {
    const errors: ValidationError[] = [];
    const { network, horizonUrl, contractAddresses } = config.stellar;

    if (network !== 'mainnet' && network !== 'testnet') {
        errors.push({
            field: 'stellar.network',
            message: 'Network must be either mainnet or testnet',
            code: 'UNSUPPORTED_NETWORK',
        });
        return errors;
    }

    if (network === 'mainnet' && horizonUrl === TESTNET_HORIZON) {
        errors.push({
            field: 'stellar.horizonUrl',
            message: 'Horizon URL points to testnet but network is set to mainnet',
            code: 'HORIZON_NETWORK_MISMATCH',
        });
    }

    if (network === 'testnet' && horizonUrl === MAINNET_HORIZON) {
        errors.push({
            field: 'stellar.horizonUrl',
            message: 'Horizon URL points to mainnet but network is set to testnet',
            code: 'HORIZON_NETWORK_MISMATCH',
        });
    }

    // ── Branding validation ────────────────────────────────────────────────────

    if (config.branding.primaryColor === config.branding.secondaryColor) {
        errors.push({
            field: 'branding.secondaryColor',
            message: 'Secondary color must differ from primary color',
            code: 'DUPLICATE_COLORS',
        });
    }

    // Validate contract addresses if provided
    const contractValidation = validateContractAddresses(contractAddresses);
    if (!contractValidation.valid) {
        errors.push({
            field: contractValidation.field,
            message: contractValidation.reason,
            code: contractValidation.code,
        });
    }

    return errors;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Validate a customization config payload.
 * Returns a stable ValidationResult with field-level errors.
 * Safe to call from both API routes and internal services.
 *
 * Network validation is performed by StellarNetworkService to provide
 * detailed, actionable error messages for unsupported or invalid networks.
 */
export function validateCustomizationConfig(input: unknown): ValidationResult {
    const parsed = customizationConfigSchema.safeParse(input);

    if (!parsed.success) {
        const errors: ValidationError[] = parsed.error.errors.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
            code: e.code.toUpperCase(),
        }));
        return { valid: false, errors };
    }

    // Type-cast parsed data for business rule validation
    // (safe because schema validation passed all required checks)
    const config = parsed.data as unknown as CustomizationConfig;

    const businessErrors = businessRuleErrors(config);
    if (businessErrors.length > 0) {
        return { valid: false, errors: businessErrors };
    }

    return { valid: true, errors: [] };
}

// ── Endpoint Connectivity Validation (Async) ─────────────────────────────────

export interface EndpointValidationResult {
    valid: boolean;
    horizon: ConnectivityCheckResult;
    sorobanRpc?: ConnectivityCheckResult;
    errors?: ValidationError[];
}

/**
 * Validate that configured Stellar endpoints are reachable.
 * Checks both Horizon and optional Soroban RPC endpoints with timeouts.
 * Distinguishes between transient errors (retry-able) and configuration errors.
 * 
 * Should be called during deployment or after configuration changes.
 * 
 * @param config - Customization config with Stellar endpoints
 * @param options - Optional timeout in milliseconds (default 5000)
 * @returns Endpoint validation result with reachability status and error details
 */
export async function validateStellarEndpoints(
    config: CustomizationConfig,
    options?: { timeout?: number }
): Promise<EndpointValidationResult> {
    const { horizonUrl, sorobanRpcUrl } = config.stellar;

    const checks = await checkStellarEndpoints(horizonUrl, sorobanRpcUrl, options);

    // First check must be Horizon
    const horizonResult = checks[0];
    const sorobanResult = checks[1];

    const errors: ValidationError[] = [];

    // Check if critical Horizon endpoint is unreachable
    if (!horizonResult.reachable) {
        const errorType = horizonResult.errorType;
        const errorMessage =
            errorType === 'VALIDATION'
                ? `Invalid Horizon URL format: ${horizonResult.error}`
                : errorType === 'TRANSIENT'
                ? `Horizon endpoint temporarily unreachable (${horizonResult.error}). Please retry deployment.`
                : `Horizon endpoint not reachable (${horizonResult.error}). Check configuration.`;

        errors.push({
            field: 'stellar.horizonUrl',
            message: errorMessage,
            code: `HORIZON_${errorType}_ERROR`,
        });
    }

    // Check optional Soroban RPC endpoint if configured
    if (sorobanResult && !sorobanResult.reachable) {
        const errorType = sorobanResult.errorType;
        const errorMessage =
            errorType === 'VALIDATION'
                ? `Invalid Soroban RPC URL format: ${sorobanResult.error}`
                : errorType === 'TRANSIENT'
                ? `Soroban RPC endpoint temporarily unreachable (${sorobanResult.error}). Please retry deployment.`
                : `Soroban RPC endpoint not reachable (${sorobanResult.error}). Check configuration.`;

        errors.push({
            field: 'stellar.sorobanRpcUrl',
            message: errorMessage,
            code: `SOROBAN_${errorType}_ERROR`,
        });
    }

    return {
        valid: errors.length === 0,
        horizon: horizonResult,
        sorobanRpc: sorobanResult,
        errors: errors.length > 0 ? errors : undefined,
    };
}
