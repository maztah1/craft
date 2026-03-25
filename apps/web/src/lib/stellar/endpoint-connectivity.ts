/**
 * Horizon Endpoint Connectivity Check
 *
 * Validates that configured Horizon and Soroban RPC endpoints are reachable
 * and responsive. Distinguishes between:
 * - Format errors (invalid URLs)
 * - Connectivity errors (temporary/transient - timeout, 503, etc.)
 * - Configuration errors (permanent - wrong endpoint, 404, auth failures)
 */

export type ConnectivityErrorType = 'VALIDATION' | 'TRANSIENT' | 'CONFIGURATION';

export interface ConnectivityCheckResult {
    reachable: boolean;
    endpoint: string;
    status?: number;
    responseTime?: number;
    errorType?: ConnectivityErrorType;
    error?: string;
}

export interface HorizonCheckOptions {
    timeout?: number; // milliseconds, default 5000
    retries?: number; // default 1 (no retries)
}

const DEFAULT_TIMEOUT = 5000;
const DEFAULT_RETRIES = 1;

/**
 * Transient error codes that should be classified as temporary/recoverable.
 */
const TRANSIENT_HTTP_CODES = new Set([
    408, // Request Timeout
    429, // Too Many Requests
    500, // Internal Server Error
    502, // Bad Gateway
    503, // Service Unavailable
    504, // Gateway Timeout
]);

/**
 * Check if a Horizon endpoint is reachable by testing GET /
 * 
 * @param horizonUrl - The Horizon endpoint URL
 * @param options - Check options (timeout, retries)
 * @returns Connectivity check result with reachability status
 */
export async function checkHorizonEndpoint(
    horizonUrl: string,
    options: HorizonCheckOptions = {}
): Promise<ConnectivityCheckResult> {
    const timeout = options.timeout ?? DEFAULT_TIMEOUT;
    const maxRetries = options.retries ?? DEFAULT_RETRIES;

    // Validate URL format first
    try {
        const parsed = new URL(horizonUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new Error('Unsupported protocol');
        }
    } catch {
        return {
            reachable: false,
            endpoint: horizonUrl,
            errorType: 'VALIDATION',
            error: 'Invalid Horizon URL format',
        };
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const startTime = performance.now();

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            try {
                const response = await fetch(new URL('/', horizonUrl).toString(), {
                    method: 'GET',
                    signal: controller.signal,
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': 'Craft-Platform-Validator/1.0',
                    },
                });

                clearTimeout(timeoutId);
                const responseTime = performance.now() - startTime;

                // Health check: Horizon returns 200 OK with JSON
                if (response.ok) {
                    return {
                        reachable: true,
                        endpoint: horizonUrl,
                        status: response.status,
                        responseTime,
                    };
                }

                // Determine error type based on status code
                const errorType = TRANSIENT_HTTP_CODES.has(response.status)
                    ? 'TRANSIENT'
                    : response.status === 404
                    ? 'CONFIGURATION'
                    : response.status >= 400 && response.status < 500
                    ? 'CONFIGURATION'
                    : 'TRANSIENT';

                return {
                    reachable: false,
                    endpoint: horizonUrl,
                    status: response.status,
                    responseTime,
                    errorType,
                    error: `HTTP ${response.status}`,
                };
            } catch (err) {
                if (err instanceof DOMException && err.name === 'AbortError') {
                    lastError = new Error(`Timeout after ${timeout}ms`);

                    if (attempt === maxRetries - 1) {
                        return {
                            reachable: false,
                            endpoint: horizonUrl,
                            errorType: 'TRANSIENT',
                            error: lastError.message,
                        };
                    }
                    // Retry on timeout
                    continue;
                }

                lastError = err instanceof Error ? err : new Error(String(err));
                clearTimeout(timeoutId);

                // Network errors are typically transient
                if (attempt === maxRetries - 1) {
                    return {
                        reachable: false,
                        endpoint: horizonUrl,
                        errorType: 'TRANSIENT',
                        error: lastError.message,
                    };
                }
            }
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
        }
    }

    return {
        reachable: false,
        endpoint: horizonUrl,
        errorType: 'TRANSIENT',
        error: lastError?.message ?? 'Unknown error',
    };
}

/**
 * Check if a Soroban RPC endpoint is reachable.
 * Soroban RPC uses JSON-RPC so we test with a simple getNetwork call.
 * 
 * @param sorobanRpcUrl - The Soroban RPC endpoint URL
 * @param options - Check options (timeout, retries)
 * @returns Connectivity check result
 */
export async function checkSorobanRpcEndpoint(
    sorobanRpcUrl: string,
    options: HorizonCheckOptions = {}
): Promise<ConnectivityCheckResult> {
    const timeout = options.timeout ?? DEFAULT_TIMEOUT;
    const maxRetries = options.retries ?? DEFAULT_RETRIES;

    // Validate URL format first
    try {
        const parsed = new URL(sorobanRpcUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new Error('Unsupported protocol');
        }
    } catch {
        return {
            reachable: false,
            endpoint: sorobanRpcUrl,
            errorType: 'VALIDATION',
            error: 'Invalid Soroban RPC URL format',
        };
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const startTime = performance.now();

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            try {
                const response = await fetch(sorobanRpcUrl, {
                    method: 'POST',
                    signal: controller.signal,
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': 'Craft-Platform-Validator/1.0',
                    },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: 'craft-health-check',
                        method: 'getNetwork',
                        params: [],
                    }),
                });

                clearTimeout(timeoutId);
                const responseTime = performance.now() - startTime;

                // Successful JSON-RPC response (even if it's an error response)
                if (response.status === 200) {
                    return {
                        reachable: true,
                        endpoint: sorobanRpcUrl,
                        status: response.status,
                        responseTime,
                    };
                }

                // Determine error type based on status code
                const errorType = TRANSIENT_HTTP_CODES.has(response.status)
                    ? 'TRANSIENT'
                    : response.status === 404
                    ? 'CONFIGURATION'
                    : response.status >= 400 && response.status < 500
                    ? 'CONFIGURATION'
                    : 'TRANSIENT';

                return {
                    reachable: false,
                    endpoint: sorobanRpcUrl,
                    status: response.status,
                    responseTime,
                    errorType,
                    error: `HTTP ${response.status}`,
                };
            } catch (err) {
                if (err instanceof DOMException && err.name === 'AbortError') {
                    lastError = new Error(`Timeout after ${timeout}ms`);

                    if (attempt === maxRetries - 1) {
                        return {
                            reachable: false,
                            endpoint: sorobanRpcUrl,
                            errorType: 'TRANSIENT',
                            error: lastError.message,
                        };
                    }
                    // Retry on timeout
                    continue;
                }

                lastError = err instanceof Error ? err : new Error(String(err));
                clearTimeout(timeoutId);

                // Network errors are typically transient
                if (attempt === maxRetries - 1) {
                    return {
                        reachable: false,
                        endpoint: sorobanRpcUrl,
                        errorType: 'TRANSIENT',
                        error: lastError.message,
                    };
                }
            }
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
        }
    }

    return {
        reachable: false,
        endpoint: sorobanRpcUrl,
        errorType: 'TRANSIENT',
        error: lastError?.message ?? 'Unknown error',
    };
}

/**
 * Check all configured Stellar endpoints (Horizon and optional Soroban RPC).
 * Returns detailed results for each endpoint.
 * 
 * @param horizonUrl - Horizon endpoint URL to test
 * @param sorobanRpcUrl - Optional Soroban RPC endpoint URL to test
 * @param options - Check options
 * @returns Array of connectivity check results
 */
export async function checkStellarEndpoints(
    horizonUrl: string,
    sorobanRpcUrl?: string,
    options: HorizonCheckOptions = {}
): Promise<ConnectivityCheckResult[]> {
    const horizonResult = await checkHorizonEndpoint(horizonUrl, options);
    const results: ConnectivityCheckResult[] = [horizonResult];

    // If Horizon URL itself is invalid, do not proceed with optional checks.
    if (horizonResult.errorType === 'VALIDATION') {
        return results;
    }

    if (sorobanRpcUrl) {
        results.push(await checkSorobanRpcEndpoint(sorobanRpcUrl, options));
    }

    return results;
}
