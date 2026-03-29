import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import {
    resolveCorrelationId,
    createLogger,
    withLogging,
    CORRELATION_ID_HEADER,
} from './logger';

// ── resolveCorrelationId ──────────────────────────────────────────────────────

describe('resolveCorrelationId', () => {
    it('returns the header value when present and valid', () => {
        const req = new NextRequest('http://localhost/', {
            headers: { [CORRELATION_ID_HEADER]: 'abc-123-def-456' },
        });
        expect(resolveCorrelationId(req)).toBe('abc-123-def-456');
    });

    it('generates a UUID when the header is absent', () => {
        const req = new NextRequest('http://localhost/');
        const id = resolveCorrelationId(req);
        expect(id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('generates a UUID when the header value is too short', () => {
        const req = new NextRequest('http://localhost/', {
            headers: { [CORRELATION_ID_HEADER]: 'short' },
        });
        const id = resolveCorrelationId(req);
        // Must not echo back the invalid header
        expect(id).not.toBe('short');
        expect(id.length).toBeGreaterThanOrEqual(36);
    });

    it('generates a new UUID on each call when no header is present', () => {
        const req = new NextRequest('http://localhost/');
        const a = resolveCorrelationId(req);
        const b = resolveCorrelationId(req);
        expect(a).not.toBe(b);
    });
});

// ── createLogger ──────────────────────────────────────────────────────────────

describe('createLogger', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    function lastCallArg(spy: ReturnType<typeof vi.spyOn>): LogEntry {
        const raw = (spy as any).mock.calls.at(-1)?.[0] as string;
        return JSON.parse(raw);
    }

    interface LogEntry {
        level: string;
        message: string;
        correlationId: string;
        timestamp: string;
        stack?: string;
        metadata: Record<string, unknown>;
    }

    it('writes info entries to console.log as JSON', () => {
        const log = createLogger({ correlationId: 'cid-1', userId: 'u1' });
        log.info('hello', { extra: 42 });

        const entry = lastCallArg(console.log as any);
        expect(entry.level).toBe('info');
        expect(entry.message).toBe('hello');
        expect(entry.correlationId).toBe('cid-1');
        expect(entry.metadata.userId).toBe('u1');
        expect(entry.metadata.extra).toBe(42);
        expect(entry.timestamp).toBeTruthy();
    });

    it('writes warn entries to console.warn', () => {
        const log = createLogger({ correlationId: 'cid-2' });
        log.warn('watch out');

        const entry = lastCallArg(console.warn as any);
        expect(entry.level).toBe('warn');
        expect(entry.message).toBe('watch out');
    });

    it('writes error entries to console.error with stack trace', () => {
        const log = createLogger({ correlationId: 'cid-3' });
        const err = new Error('boom');
        log.error('something failed', err, { stage: 'deploy' });

        const entry = lastCallArg(console.error as any);
        expect(entry.level).toBe('error');
        expect(entry.message).toBe('something failed');
        expect(entry.stack).toContain('boom');
        expect(entry.metadata.stage).toBe('deploy');
    });

    it('does not include stack when error has none', () => {
        const log = createLogger({ correlationId: 'cid-4' });
        log.error('plain error', 'not an Error object');

        const entry = lastCallArg(console.error as any);
        expect(entry.stack).toBeUndefined();
    });

    it('does not leak correlationId into metadata', () => {
        const log = createLogger({ correlationId: 'cid-5', userId: 'u2' });
        log.info('test');

        const entry = lastCallArg(console.log as any);
        expect(entry.metadata.correlationId).toBeUndefined();
        expect(entry.correlationId).toBe('cid-5');
    });
});

// ── withLogging ───────────────────────────────────────────────────────────────

describe('withLogging', () => {
    it('echoes correlation ID from request header in response', async () => {
        const handler = withLogging(async (_req, { correlationId }) => {
            return NextResponse.json({ ok: true, correlationId });
        });

        const req = new NextRequest('http://localhost/api/test', {
            headers: { [CORRELATION_ID_HEADER]: 'req-corr-id-1234' },
        });
        const res = await handler(req, { params: {} });

        expect(res.headers.get(CORRELATION_ID_HEADER)).toBe('req-corr-id-1234');
    });

    it('generates a correlation ID when header is absent', async () => {
        const handler = withLogging(async (_req, { correlationId }) => {
            return NextResponse.json({ correlationId });
        });

        const req = new NextRequest('http://localhost/api/test');
        const res = await handler(req, { params: {} });

        const id = res.headers.get(CORRELATION_ID_HEADER);
        expect(id).toBeTruthy();
        expect(id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('returns 500 with correlationId when handler throws', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const handler = withLogging(async () => {
            throw new Error('unexpected');
        });

        const req = new NextRequest('http://localhost/api/test', {
            headers: { [CORRELATION_ID_HEADER]: 'err-corr-id-5678' },
        });
        const res = await handler(req, { params: {} });

        expect(res.status).toBe(500);
        expect(res.headers.get(CORRELATION_ID_HEADER)).toBe('err-corr-id-5678');
        const body = await res.json();
        expect(body.correlationId).toBe('err-corr-id-5678');
        expect(body.error).toBe('Internal server error');
    });
});
