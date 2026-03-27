import type { SupabaseClient } from '@supabase/supabase-js';
import type {
    LogsQueryParams,
    LogLevel,
    DeploymentLogResponse,
    PaginatedLogsResponse,
} from '@craft/types';

const MAX_LIMIT = 200;
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const DEFAULT_ORDER = 'asc' as const;
const VALID_LEVELS: LogLevel[] = ['info', 'warn', 'error'];
const VALID_ORDERS = ['asc', 'desc'] as const;
const VALID_STAGES = [
    'pending',
    'generating',
    'creating_repo',
    'pushing_code',
    'deploying',
    'completed',
    'failed',
    'redeploying',
    'deleted',
] as const;

export type ParseResult =
    | { valid: true; params: LogsQueryParams }
    | { valid: false };

/**
 * Extended logs query params with stage filtering
 */
export interface ExtendedLogsQueryParams extends LogsQueryParams {
    stage?: string;
}

/**
 * Validates and normalises the query parameters for the logs route.
 * Returns { valid: false } on any validation failure — no DB query should
 * be executed in that case.
 *
 * Supports filtering by:
 * - page: Pagination page number
 * - limit: Number of results per page
 * - order: Sort order (asc/desc)
 * - since: Filter logs after this timestamp
 * - level: Filter by log level (info/warn/error)
 * - stage: Filter by deployment stage
 */
export function parseLogsQueryParams(searchParams: URLSearchParams): ParseResult {
    // page
    const rawPage = searchParams.get('page');
    let page = DEFAULT_PAGE;
    if (rawPage !== null) {
        const n = Number(rawPage);
        if (!Number.isInteger(n) || n < 1) return { valid: false };
        page = n;
    }

    // limit
    const rawLimit = searchParams.get('limit');
    let limit = DEFAULT_LIMIT;
    if (rawLimit !== null) {
        const n = Number(rawLimit);
        if (!Number.isInteger(n) || n < 1) return { valid: false };
        limit = Math.min(n, MAX_LIMIT);
    }

    // order
    const rawOrder = searchParams.get('order');
    let order: 'asc' | 'desc' = DEFAULT_ORDER;
    if (rawOrder !== null) {
        if (!VALID_ORDERS.includes(rawOrder as 'asc' | 'desc')) return { valid: false };
        order = rawOrder as 'asc' | 'desc';
    }

    // since
    const rawSince = searchParams.get('since');
    let since: string | undefined;
    if (rawSince !== null) {
        const d = new Date(rawSince);
        if (isNaN(d.getTime())) return { valid: false };
        since = rawSince;
    }

    // level
    const rawLevel = searchParams.get('level');
    let level: LogLevel | undefined;
    if (rawLevel !== null) {
        if (!VALID_LEVELS.includes(rawLevel as LogLevel)) return { valid: false };
        level = rawLevel as LogLevel;
    }

    // stage
    const rawStage = searchParams.get('stage');
    let stage: string | undefined;
    if (rawStage !== null) {
        if (!VALID_STAGES.includes(rawStage as typeof VALID_STAGES[number])) return { valid: false };
        stage = rawStage;
    }

    return { valid: true, params: { page, limit, order, since, level, stage } };
}

export const deploymentLogsService = {
    /**
     * Get logs for a deployment with filtering support.
     *
     * @param deploymentId - The deployment ID to fetch logs for
     * @param params - Query parameters for filtering and pagination
     * @param supabase - Supabase client instance
     * @returns Paginated logs response with metadata
     */
    async getLogs(
        deploymentId: string,
        params: ExtendedLogsQueryParams,
        supabase: SupabaseClient,
    ): Promise<PaginatedLogsResponse> {
        const { page, limit, order, since, level, stage } = params;
        const offset = (page - 1) * limit;

        let query = supabase
            .from('deployment_logs')
            .select('id, deployment_id, stage, created_at, level, message', { count: 'exact' })
            .eq('deployment_id', deploymentId);

        // Apply filters
        if (since) query = query.gt('created_at', since);
        if (level) query = query.eq('level', level);
        if (stage) query = query.eq('stage', stage);

        // Apply ordering and pagination
        query = query
            .order('created_at', { ascending: order === 'asc' })
            .range(offset, offset + limit - 1);

        const { data, count, error } = await query;

        if (error) throw new Error(error.message ?? 'Failed to retrieve logs');

        const rows = (data ?? []) as Array<{
            id: string;
            deployment_id: string;
            stage: string;
            created_at: string;
            level: LogLevel;
            message: string;
        }>;

        const total = count ?? 0;

        return {
            data: rows.map((row) => ({
                id: row.id,
                deploymentId: row.deployment_id,
                timestamp: row.created_at,
                level: row.level,
                message: row.message,
            })),
            pagination: {
                page,
                limit,
                total,
                hasNextPage: offset + limit < total,
            },
        };
    },

    /**
     * Get logs for multiple deployments (batch operation).
     * Useful for dashboard views showing logs across deployments.
     *
     * @param deploymentIds - Array of deployment IDs to fetch logs for
     * @param params - Query parameters for filtering and pagination
     * @param supabase - Supabase client instance
     * @returns Paginated logs response with metadata
     */
    async getLogsBatch(
        deploymentIds: string[],
        params: ExtendedLogsQueryParams,
        supabase: SupabaseClient,
    ): Promise<PaginatedLogsResponse> {
        const { page, limit, order, since, level, stage } = params;
        const offset = (page - 1) * limit;

        let query = supabase
            .from('deployment_logs')
            .select('id, deployment_id, stage, created_at, level, message', { count: 'exact' })
            .in('deployment_id', deploymentIds);

        // Apply filters
        if (since) query = query.gt('created_at', since);
        if (level) query = query.eq('level', level);
        if (stage) query = query.eq('stage', stage);

        // Apply ordering and pagination
        query = query
            .order('created_at', { ascending: order === 'asc' })
            .range(offset, offset + limit - 1);

        const { data, count, error } = await query;

        if (error) throw new Error(error.message ?? 'Failed to retrieve logs');

        const rows = (data ?? []) as Array<{
            id: string;
            deployment_id: string;
            stage: string;
            created_at: string;
            level: LogLevel;
            message: string;
        }>;

        const total = count ?? 0;

        return {
            data: rows.map((row) => ({
                id: row.id,
                deploymentId: row.deployment_id,
                timestamp: row.created_at,
                level: row.level,
                message: row.message,
            })),
            pagination: {
                page,
                limit,
                total,
                hasNextPage: offset + limit < total,
            },
        };
    },

    /**
     * Get logs by time range for a deployment.
     * Convenience method for time-based filtering.
     *
     * @param deploymentId - The deployment ID to fetch logs for
     * @param startTime - Start of time range (ISO 8601)
     * @param endTime - End of time range (ISO 8601)
     * @param supabase - Supabase client instance
     * @returns Array of log entries within the time range
     */
    async getLogsByTimeRange(
        deploymentId: string,
        startTime: string,
        endTime: string,
        supabase: SupabaseClient,
    ): Promise<DeploymentLogResponse[]> {
        const { data, error } = await supabase
            .from('deployment_logs')
            .select('id, deployment_id, stage, created_at, level, message')
            .eq('deployment_id', deploymentId)
            .gte('created_at', startTime)
            .lte('created_at', endTime)
            .order('created_at', { ascending: true });

        if (error) throw new Error(error.message ?? 'Failed to retrieve logs');

        const rows = (data ?? []) as Array<{
            id: string;
            deployment_id: string;
            stage: string;
            created_at: string;
            level: LogLevel;
            message: string;
        }>;

        return rows.map((row) => ({
            id: row.id,
            deploymentId: row.deployment_id,
            timestamp: row.created_at,
            level: row.level,
            message: row.message,
        }));
    },

    /**
     * Get logs by level for a deployment.
     * Convenience method for level-based filtering.
     *
     * @param deploymentId - The deployment ID to fetch logs for
     * @param logLevel - The log level to filter by
     * @param supabase - Supabase client instance
     * @returns Array of log entries with the specified level
     */
    async getLogsByLevel(
        deploymentId: string,
        logLevel: LogLevel,
        supabase: SupabaseClient,
    ): Promise<DeploymentLogResponse[]> {
        const { data, error } = await supabase
            .from('deployment_logs')
            .select('id, deployment_id, stage, created_at, level, message')
            .eq('deployment_id', deploymentId)
            .eq('level', logLevel)
            .order('created_at', { ascending: true });

        if (error) throw new Error(error.message ?? 'Failed to retrieve logs');

        const rows = (data ?? []) as Array<{
            id: string;
            deployment_id: string;
            stage: string;
            created_at: string;
            level: LogLevel;
            message: string;
        }>;

        return rows.map((row) => ({
            id: row.id,
            deploymentId: row.deployment_id,
            timestamp: row.created_at,
            level: row.level,
            message: row.message,
        }));
    },

    /**
     * Get logs by stage for a deployment.
     * Convenience method for stage-based filtering.
     *
     * @param deploymentId - The deployment ID to fetch logs for
     * @param deploymentStage - The deployment stage to filter by
     * @param supabase - Supabase client instance
     * @returns Array of log entries for the specified stage
     */
    async getLogsByStage(
        deploymentId: string,
        deploymentStage: string,
        supabase: SupabaseClient,
    ): Promise<DeploymentLogResponse[]> {
        const { data, error } = await supabase
            .from('deployment_logs')
            .select('id, deployment_id, stage, created_at, level, message')
            .eq('deployment_id', deploymentId)
            .eq('stage', deploymentStage)
            .order('created_at', { ascending: true });

        if (error) throw new Error(error.message ?? 'Failed to retrieve logs');

        const rows = (data ?? []) as Array<{
            id: string;
            deployment_id: string;
            stage: string;
            created_at: string;
            level: LogLevel;
            message: string;
        }>;

        return rows.map((row) => ({
            id: row.id,
            deploymentId: row.deployment_id,
            timestamp: row.created_at,
            level: row.level,
            message: row.message,
        }));
    },
};
