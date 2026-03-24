import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { AuthService } from './auth.service';

// --- Supabase mock ---
const mockGetUser = vi.fn();
const mockUpdateUser = vi.fn();
const mockProfileSelect = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        auth: {
            getUser: mockGetUser,
            updateUser: mockUpdateUser,
        },
        from: (_table: string) => ({
            select: (_cols: string) => ({
                eq: (_col: string, _val: string) => ({
                    single: mockProfileSelect,
                }),
            }),
        }),
    }),
}));

// --- Arbitraries ---

const userId = fc.stringMatching(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);

const userRecord = fc.record({
    id: userId,
    email: fc
        .tuple(
            fc.stringMatching(/^[a-z][a-z0-9]{3,8}$/),
            fc.stringMatching(/^[a-z]{3,6}$/),
            fc.constantFrom('com', 'org', 'io')
        )
        .map(([l, d, t]) => `${l}@${d}.${t}`),
    created_at: fc.constant(new Date().toISOString()),
});

const profileRecord = fc.record({
    subscription_tier: fc.constantFrom('free', 'pro', 'enterprise'),
    github_connected: fc.boolean(),
});

const profileUpdate = fc.record(
    {
        email: fc
            .tuple(
                fc.stringMatching(/^[a-z][a-z0-9]{3,8}$/),
                fc.stringMatching(/^[a-z]{3,6}$/),
                fc.constantFrom('com', 'net', 'io')
            )
            .map(([l, d, t]) => `${l}@${d}.${t}`),
        fullName: fc.string({ minLength: 1, maxLength: 50 }),
    },
    { requiredKeys: [] }
);

// --- Property 3: User data isolation ---
describe("Property 3 — users cannot read or mutate another user's data", () => {
    beforeEach(() => vi.clearAllMocks());

    it('getCurrentUser always returns the session owner, never another user', async () => {
        await fc.assert(
            fc.asyncProperty(userRecord, userRecord, profileRecord, async (sessionUser, otherUser, profile) => {
                fc.pre(sessionUser.id !== otherUser.id);

                mockGetUser.mockResolvedValue({ data: { user: sessionUser } });
                mockProfileSelect.mockResolvedValue({ data: profile });

                const service = new AuthService();
                const result = await service.getCurrentUser();

                expect(result?.id).toBe(sessionUser.id);
                expect(result?.id).not.toBe(otherUser.id);
                expect(result?.email).toBe(sessionUser.email);
            }),
            { numRuns: 100 }
        );
    });

    it('updateProfile always operates on the session owner regardless of the userId argument', async () => {
        await fc.assert(
            fc.asyncProperty(userRecord, userId, profileRecord, async (sessionUser, foreignId, profile) => {
                fc.pre(sessionUser.id !== foreignId);

                mockUpdateUser.mockResolvedValue({ error: null });
                // getUser always returns the authenticated session owner
                mockGetUser.mockResolvedValue({ data: { user: sessionUser } });
                mockProfileSelect.mockResolvedValue({ data: profile });

                const service = new AuthService();
                const result = await service.updateProfile(foreignId, {});

                expect(result.id).toBe(sessionUser.id);
                expect(result.id).not.toBe(foreignId);
            }),
            { numRuns: 100 }
        );
    });
});

// --- Property 4: Profile update round-trip ---
describe('Property 4 — profile updates persist and reload without losing supported fields', () => {
    beforeEach(() => vi.clearAllMocks());

    it('updated email is reflected in the returned User', async () => {
        await fc.assert(
            fc.asyncProperty(userRecord, profileRecord, profileUpdate, async (sessionUser, profile, update) => {
                fc.pre(!!update.email);

                mockUpdateUser.mockResolvedValue({ error: null });
                mockGetUser.mockResolvedValue({
                    data: { user: { ...sessionUser, email: update.email! } },
                });
                mockProfileSelect.mockResolvedValue({ data: profile });

                const service = new AuthService();
                const result = await service.updateProfile(sessionUser.id, update);

                // Round-trip: updated email comes back
                expect(result.email).toBe(update.email);
                // Stable fields must not be lost
                expect(result.id).toBe(sessionUser.id);
                expect(result.subscriptionTier).toBe(profile.subscription_tier);
                expect(result.githubConnected).toBe(profile.github_connected);
            }),
            { numRuns: 100 }
        );
    });

    it('update without email preserves the existing email unchanged', async () => {
        await fc.assert(
            fc.asyncProperty(userRecord, profileRecord, async (sessionUser, profile) => {
                mockGetUser.mockResolvedValue({ data: { user: sessionUser } });
                mockProfileSelect.mockResolvedValue({ data: profile });

                const service = new AuthService();
                const result = await service.updateProfile(sessionUser.id, { fullName: 'Any Name' });

                expect(result.email).toBe(sessionUser.email);
                expect(result.subscriptionTier).toBe(profile.subscription_tier);
                expect(result.githubConnected).toBe(profile.github_connected);
                expect(mockUpdateUser).not.toHaveBeenCalled();
            }),
            { numRuns: 100 }
        );
    });

    it('subscriptionTier and githubConnected are never mutated by updateProfile', async () => {
        await fc.assert(
            fc.asyncProperty(userRecord, profileRecord, profileUpdate, async (sessionUser, profile, update) => {
                mockUpdateUser.mockResolvedValue({ error: null });
                mockGetUser.mockResolvedValue({
                    data: { user: { ...sessionUser, email: update.email ?? sessionUser.email } },
                });
                mockProfileSelect.mockResolvedValue({ data: profile });

                const service = new AuthService();
                const result = await service.updateProfile(sessionUser.id, update);

                // ProfileUpdate carries no tier/github fields — these must survive unchanged
                expect(result.subscriptionTier).toBe(profile.subscription_tier);
                expect(result.githubConnected).toBe(profile.github_connected);
            }),
            { numRuns: 100 }
        );
    });
});
