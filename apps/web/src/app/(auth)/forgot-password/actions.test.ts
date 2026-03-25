import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import after stubbing globals
const { forgotPasswordAction } = await import('./actions');

const idle = { status: 'idle' as const, message: '' };

function makeFormData(fields: Record<string, string>): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    return fd;
}

describe('forgotPasswordAction', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns error when email is empty', async () => {
        const result = await forgotPasswordAction(idle, makeFormData({
            email: '',
        }));
        expect(result.status).toBe('error');
        expect(result.message).toMatch(/email.+required/i);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns error for invalid email format', async () => {
        const result = await forgotPasswordAction(idle, makeFormData({
            email: 'not-an-email',
        }));
        expect(result.status).toBe('error');
        expect(result.message).toMatch(/valid email/i);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns success on 200 response', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ message: 'Reset link sent' }),
        });
        const result = await forgotPasswordAction(idle, makeFormData({
            email: 'user@example.com',
        }));
        expect(result.status).toBe('success');
        expect(result.message).toMatch(/check your email/i);
    });

    it('returns rate limit message on 429', async () => {
        mockFetch.mockResolvedValue({
            ok: false,
            status: 429,
            json: async () => ({ error: 'Rate limited' }),
        });
        const result = await forgotPasswordAction(idle, makeFormData({
            email: 'user@example.com',
        }));
        expect(result.status).toBe('error');
        expect(result.message).toMatch(/too many requests/i);
    });

    it('returns network error message when fetch throws', async () => {
        mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
        const result = await forgotPasswordAction(idle, makeFormData({
            email: 'user@example.com',
        }));
        expect(result.status).toBe('error');
        expect(result.message).toMatch(/network error/i);
    });

    it('returns API error message on other failures', async () => {
        mockFetch.mockResolvedValue({
            ok: false,
            status: 400,
            json: async () => ({ error: 'Invalid input' }),
        });
        const result = await forgotPasswordAction(idle, makeFormData({
            email: 'user@example.com',
        }));
        expect(result.status).toBe('error');
        expect(result.message).toBe('Invalid input');
    });

    it('returns generic fallback when API returns no error object', async () => {
        mockFetch.mockResolvedValue({
            ok: false,
            status: 500,
            json: async () => ({}),
        });
        const result = await forgotPasswordAction(idle, makeFormData({
            email: 'user@example.com',
        }));
        expect(result.status).toBe('error');
        expect(result.message).toMatch(/something went wrong/i);
    });
});
