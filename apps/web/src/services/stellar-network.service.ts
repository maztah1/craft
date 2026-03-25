/**
 * StellarNetworkService
 *
 * Validates and manages Stellar network selection and metadata.
 * Ensures only supported networks (mainnet, testnet) are accepted and
 * provides downstream configuration data for code generation.
 *
 * Property: Network Configuration Correctness
 * For any supported network identifier, the service MUST provide:
 *   - Correct network passphrase
 *   - Correct Horizon API endpoint
 *   - Correct Soroban RPC endpoint (if applicable)
 *   - Clear error messages for unsupported networks
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type StellarNetworkId = 'mainnet' | 'testnet';

export interface NetworkMetadata {
    id: StellarNetworkId;
    name: string;
    networkPassphrase: string;
    horizonUrl: string;
    sorobanRpcUrl: string;
    /** Configuration values suitable for environment variables */
    environment: {
        NEXT_PUBLIC_STELLAR_NETWORK: string;
        NEXT_PUBLIC_HORIZON_URL: string;
        NEXT_PUBLIC_NETWORK_PASSPHRASE: string;
        NEXT_PUBLIC_SOROBAN_RPC_URL: string;
    };
}

export interface NetworkValidationError {
    field: 'stellar.network';
    message: string;
    code:
        | 'UNSUPPORTED_NETWORK'
        | 'MISSING_NETWORK'
        | 'INVALID_NETWORK_TYPE'
        | 'NETWORK_TYPE_COERCION_FAILED';
}

export interface NetworkValidationResult {
    valid: boolean;
    network?: StellarNetworkId;
    metadata?: NetworkMetadata;
    error?: NetworkValidationError;
}

// ── Network Registry ─────────────────────────────────────────────────────────

/**
 * Centralized network registry. All network metadata is defined here.
 * This is the single source of truth for supported networks and their configuration.
 */
const NETWORK_REGISTRY: Record<StellarNetworkId, NetworkMetadata> = {
    mainnet: {
        id: 'mainnet',
        name: 'Stellar Public Network (Mainnet)',
        networkPassphrase: 'Public Global Stellar Network ; September 2015',
        horizonUrl: 'https://horizon.stellar.org',
        sorobanRpcUrl: 'https://soroban-rpc.stellar.org',
        environment: {
            NEXT_PUBLIC_STELLAR_NETWORK: 'mainnet',
            NEXT_PUBLIC_HORIZON_URL: 'https://horizon.stellar.org',
            NEXT_PUBLIC_NETWORK_PASSPHRASE: 'Public Global Stellar Network ; September 2015',
            NEXT_PUBLIC_SOROBAN_RPC_URL: 'https://soroban-rpc.stellar.org',
        },
    },
    testnet: {
        id: 'testnet',
        name: 'Stellar Test Network',
        networkPassphrase: 'Test SDF Network ; September 2015',
        horizonUrl: 'https://horizon-testnet.stellar.org',
        sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
        environment: {
            NEXT_PUBLIC_STELLAR_NETWORK: 'testnet',
            NEXT_PUBLIC_HORIZON_URL: 'https://horizon-testnet.stellar.org',
            NEXT_PUBLIC_NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
            NEXT_PUBLIC_SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
        },
    },
};

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Get all supported network identifiers.
 */
export function getSupportedNetworks(): StellarNetworkId[] {
    return Object.keys(NETWORK_REGISTRY) as StellarNetworkId[];
}

/**
 * Check if a network identifier is supported.
 */
export function isNetworkSupported(network: unknown): network is StellarNetworkId {
    if (typeof network !== 'string') {
        return false;
    }
    return Object.prototype.hasOwnProperty.call(NETWORK_REGISTRY, network);
}

/**
 * Get metadata for a supported network.
 * Returns null if the network is not supported.
 */
export function getNetworkMetadata(network: StellarNetworkId): NetworkMetadata | null {
    return NETWORK_REGISTRY[network] ?? null;
}

/**
 * Validate a network selection from user input.
 *
 * Handles:
 *   - Missing/null/undefined values
 *   - Invalid types (not a string)
 *   - Unsupported network identifiers
 *
 * Returns a ValidationResult with either { valid: true, network, metadata }
 * or { valid: false, error } with a detailed error message.
 */
export function validateNetworkSelection(input: unknown): NetworkValidationResult {
    // Check if value is missing
    if (input === null || input === undefined) {
        return {
            valid: false,
            error: {
                field: 'stellar.network',
                message: 'Network selection is required. Supported values: mainnet, testnet',
                code: 'MISSING_NETWORK',
            },
        };
    }

    // Check if value is a string
    if (typeof input !== 'string') {
        return {
            valid: false,
            error: {
                field: 'stellar.network',
                message: `Network must be a string, received ${typeof input}. Supported values: mainnet, testnet`,
                code: 'INVALID_NETWORK_TYPE',
            },
        };
    }

    // Check if value is supported
    if (!isNetworkSupported(input)) {
        const supported = getSupportedNetworks();
        return {
            valid: false,
            error: {
                field: 'stellar.network',
                message: `"${input}" is not a supported network. Supported values: ${supported.join(', ')}`,
                code: 'UNSUPPORTED_NETWORK',
            },
        };
    }

    // Network is valid
    const network = input as StellarNetworkId;
    const metadata = getNetworkMetadata(network);

    if (!metadata) {
        // Should never happen due to isNetworkSupported check, but safe fallback
        return {
            valid: false,
            error: {
                field: 'stellar.network',
                message: `Failed to load metadata for network "${network}"`,
                code: 'NETWORK_TYPE_COERCION_FAILED',
            },
        };
    }

    return {
        valid: true,
        network,
        metadata,
    };
}

/**
 * Coerce a network identifier string to the correct type.
 * Useful when parsing configuration from environment variables or user input.
 *
 * @throws Error if the input is not a supported network
 *
 * Example:
 *   const network = coerceNetworkId(process.env.NEXT_PUBLIC_STELLAR_NETWORK)
 */
export function coerceNetworkId(input: unknown): StellarNetworkId {
    const result = validateNetworkSelection(input);

    if (!result.valid) {
        throw new Error(result.error!.message);
    }

    return result.network!;
}

/**
 * Service class for network validation and metadata retrieval.
 * Can be used for dependency injection and instance-based operations.
 */
export class StellarNetworkService {
    /**
     * Get all supported networks.
     */
    getSupportedNetworks(): StellarNetworkId[] {
        return getSupportedNetworks();
    }

    /**
     * Check if a network is supported.
     */
    isSupported(network: unknown): network is StellarNetworkId {
        return isNetworkSupported(network);
    }

    /**
     * Validate network selection.
     */
    validate(input: unknown): NetworkValidationResult {
        return validateNetworkSelection(input);
    }

    /**
     * Get metadata for a network.
     */
    getMetadata(network: StellarNetworkId): NetworkMetadata | null {
        return getNetworkMetadata(network);
    }

    /**
     * Coerce network identifier with error throwing.
     */
    coerce(input: unknown): StellarNetworkId {
        return coerceNetworkId(input);
    }
}

// ── Singleton instance ───────────────────────────────────────────────────────

export const stellarNetworkService = new StellarNetworkService();
