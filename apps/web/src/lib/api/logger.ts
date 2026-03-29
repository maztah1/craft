/**
 * Structured error logger with correlation ID support.
 *
 * Correlation IDs flow through the request lifecycle so that a single
 * user-facing error can be traced across service calls, deployment logs,
 * and external API calls.
 *
 * Usage:
 *   const log = createLogger({ correlationId, userId, deploymentId });
 *   log.error('GitHub push failed', err, { stage: 'pushing_code' });
 *
 * In API routes, prefer `withLogging` which generates the correlation ID
 * automatically and attaches it to the response as `X-Correlation-Id`.
 */

import { NextRequest, NextResponse } from 'next/server';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LogContext {
    correlationId: string;
    userId?: string;
    deploymentId?: string;
    /** Any additional key/value pairs to include in every log entry. */
    [key: string]: unknown;
}

export interface LogEntry {
    level: 'info' | 'warn' | 'error';
    message: string;
    correlationId: string;
    timestamp: string;
    /** Serialised error stack, present only on error-level entries. */
    stack?: string;
    /** Caller-supplied metadata merged with the base context. */
    metadata: Record<string, unknown>;
}

export interface Logger {
    info(message: string, metadata?: Record<string, unknown>): void;
    warn(message: string, metadata?: Record<string, unknown>): void;
    error(message: string, err?: unknown, metadata?: Record<string, unknown>): void;
}

// ── Correlation ID ────────────────────────────────────────────────────────────

export const CORRELATION_ID_HEADER = 'X-Correlation-Id';

/**
 * Returns the correlation ID from an incoming request header, or generates a
 * new one if the header is absent or malformed.
 */
export function resolveCorrelationId(req: NextRequest): string {
    const fromHeader = req.headers.get(CORRELATION_ID_HEADER);
    if (fromHeader && /^[\w\-]{8,128}$/.test(fromHeader)) {
        return fromHeader;
    }
    return crypto.randomUUID();
}

// ── Logger factory ────────────────────────────────────────────────────────────

/**
 * Creates a logger bound to a fixed context (correlation ID, user, etc.).
 * All entries are written to `console` as JSON so they are captured by
 * Vercel's log drain and any structured logging aggregator.
 */
export function createLogger(ctx: LogContext): Logger {
    function write(entry: LogEntry): void {
        const line = JSON.stringify(entry);
        if (entry.level === 'error') {
            console.error(line);
        } else if (entry.level === 'warn') {
            console.warn(line);
        } else {
            console.log(line);
        }
    }

    function buildEntry(
        level: LogEntry['level'],
        message: string,
        err?: unknown,
        extra?: Record<string, unknown>,
    ): LogEntry {
        const { correlationId, ...ctxRest } = ctx;
        const entry: LogEntry = {
            level,
            message,
            correlationId,
            timestamp: new Date().toISOString(),
            metadata: { ...ctxRest, ...extra },
        };
        if (err instanceof Error && err.stack) {
            entry.stack = err.stack;
        }
        return entry;
    }

    return {
        info(message, metadata) {
            write(buildEntry('info', message, undefined, metadata));
        },
        warn(message, metadata) {
            write(buildEntry('warn', message, undefined, metadata));
        },
        error(message, err, metadata) {
            write(buildEntry('error', message, err, metadata));
        },
    };
}

// ── Route middleware ──────────────────────────────────────────────────────────

type RouteHandler<TParams = {}> = (
    req: NextRequest,
    ctx: { params: TParams; correlationId: string; log: Logger }
) => Promise<NextResponse>;

/**
 * Wraps a route handler with automatic correlation ID resolution and a
 * pre-configured logger. The correlation ID is echoed back in the response
 * header so clients can include it in support requests.
 *
 * @example
 * export const POST = withLogging(async (req, { correlationId, log }) => {
 *   log.info('Processing request');
 *   // ...
 * });
 */
export function withLogging<TParams = {}>(handler: RouteHandler<TParams>) {
    return async (req: NextRequest, { params }: { params: TParams }): Promise<NextResponse> => {
        const correlationId = resolveCorrelationId(req);
        const log = createLogger({ correlationId });

        try {
            const response = await handler(req, { params, correlationId, log });
            response.headers.set(CORRELATION_ID_HEADER, correlationId);
            return response;
        } catch (err: unknown) {
            log.error('Unhandled route error', err);
            const response = NextResponse.json({ error: 'Internal server error', correlationId }, { status: 500 });
            response.headers.set(CORRELATION_ID_HEADER, correlationId);
            return response;
        }
    };
}
