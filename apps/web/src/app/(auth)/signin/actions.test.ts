import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock next/navigation redirect
const mockRedirect = vi.fn();
vi.mock('next/navigation', () => ({
    redirect: (...args: unknown[]) => {
        mockRedirect(...args);
        throw new Error('NEXT_REDIRECT');
    },
}));

// Import after stubbing globals
const { signInAction } = await import('./actions');

const idle = { status: 'idle' as const, message: '' };

function makeFormData(fields: Record<string, string>): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    return fd;
}

describe('signInAction', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns error when email is empty', async () => {
        const result = await signInAction(idle, makeFormData({
            email: '',
            password: 'password123',
        }));
        expect(result.status).toBe('error');
        expect(result.message).toMatch(/email.+required/i);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns error when password is empty', async () => {
        const result = await signInAction(idle, makeFormData({
            email: 'user@example.com',
            password: '',
        }));
        expect(result.status).toBe('error');
        expect(result.message).toMatch(/password.+required/i);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('redirects to /app on successful sign-in', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ user: { id: '1' }, session: {} }),
        });

        await expect(
            signInAction(idle, makeFormData({
                email: 'user@example.com',
                password: 'password123',
            }))
        ).rejects.toThrow('NEXT_REDIRECT');

        expect(mockRedirect).toHaveBeenCalledWith('/app');
    });

    it('returns error on 401 invalid credentials', async () => {
        mockFetch.mockResolvedValue({
            ok: false,
            status: 401,
            json: async () => ({ error: 'Invalid login credentials' }),
        });
        const result = await signInAction(idle, makeFormData({
            email: 'user@example.com',
            password: 'wrongpassword',
        }));
        expect(result.status).toBe('error');
        expect(result.message).toMatch(/invalid email or password/i);
    });

    it('returns email confirmation message when error contains "confirm"', async () => {
        mockFetch.mockResolvedValue({
            ok: false,
            status: 401,
            json: async () => ({ error: 'Email not confirmed' }),
        });
        const result = await signInAction(idle, makeFormData({
            email: 'user@example.com',
            password: 'password123',
        }));
        expect(result.status).toBe('error');
        expect(result.message).toMatch(/confirm your email/i);
    });

    it('returns rate limit message on 429', async () => {
        mockFetch.mockResolvedValue({
            ok: false,
            status: 429,
            json: async () => ({ error: 'Too many requests' }),
        });
        const result = await signInAction(idle, makeFormData({
            email: 'user@example.com',
            password: 'password123',
        }));
        expect(result.status).toBe('error');
        expect(result.message).toMatch(/too many/i);
    });

    it('returns network error message when fetch throws', async () => {
        mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
        const result = await signInAction(idle, makeFormData({
            email: 'user@example.com',
            password: 'password123',
        }));
        expect(result.status).toBe('error');
        expect(result.message).toMatch(/network error/i);
    });

    it('returns generic error on other failure statuses', async () => {
        mockFetch.mockResolvedValue({
            ok: false,
            status: 500,
            json: async () => ({ error: 'Internal server error' }),
        });
        const result = await signInAction(idle, makeFormData({
            email: 'user@example.com',
            password: 'password123',
        }));
        expect(result.status).toBe('error');
        expect(result.message).toBe('Internal server error');
    });
});
