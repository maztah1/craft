/**
 * Property 5 – Subscription Webhook Synchronization
 *
 * "For any Stripe webhook event (payment success, failure, cancellation),
 *  processing the webhook should update the user's subscription status in
 *  the database to match the Stripe event."
 *
 * Strategy
 * ────────
 * We use a hand-rolled property test loop (100 iterations, seeded PRNG) so
 * no additional dependencies are required beyond vitest.
 *
 * Each iteration:
 *   1. Generate a random initial DB profile state.
 *   2. Generate a random sequence of 1–8 webhook events.
 *   3. Run the sequence through a pure reference model that computes the
 *      expected final DB state deterministically.
 *   4. Run the same sequence through PaymentService.handleWebhook with a
 *      captured-writes Supabase mock that records every profile update.
 *   5. Assert the captured final state equals the reference model output.
 *
 * The reference model is intentionally kept separate from the implementation
 * so it can catch regressions where the service diverges from the spec.
 *
 * Assumptions / edge cases documented inline.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks (must be declared before any imports that use them) ─────────────────

const mockSubscriptionsRetrieve = vi.fn();

vi.mock('@/lib/stripe/client', () => ({
    stripe: {
        customers: { create: vi.fn() },
        checkout: { sessions: { create: vi.fn() } },
        subscriptions: {
            retrieve: mockSubscriptionsRetrieve,
            update: vi.fn(),
        },
    },
}));

vi.mock('@/lib/supabase/server', () => ({
    // createClient is replaced per-test via the capturedDb closure below
    createClient: () => supabaseFactory(),
}));

vi.mock('@/lib/stripe/pricing', () => ({
    getTierFromPriceId: (id: string) => PRICE_TO_TIER[id] ?? 'free',
}));

// ── Constants ─────────────────────────────────────────────────────────────────

const PRICE_TO_TIER: Record<string, 'pro' | 'enterprise'> = {
    price_pro: 'pro',
    price_ent: 'enterprise',
};

const PRICE_IDS = ['price_pro', 'price_ent'] as const;
const TIERS = ['free', 'pro', 'enterprise'] as const;
const SUB_STATUSES = ['active', 'past_due', 'canceled', 'unpaid'] as const;

const CUSTOMER_ID = 'cus_test';
const USER_ID = 'user-test';
const SUB_ID = 'sub_test';

// ── DB state type ─────────────────────────────────────────────────────────────

interface ProfileState {
    subscription_tier: 'free' | 'pro' | 'enterprise';
    subscription_status: string;
    stripe_subscription_id: string | null;
}

// ── Seeded PRNG (mulberry32) ──────────────────────────────────────────────────

function makePrng(seed: number) {
    let s = seed;
    return () => {
        s |= 0;
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function pick<T>(arr: readonly T[], rand: () => number): T {
    return arr[Math.floor(rand() * arr.length)];
}

// ── Event generators ──────────────────────────────────────────────────────────

type WebhookEventType =
    | 'checkout.session.completed'
    | 'customer.subscription.updated'
    | 'customer.subscription.deleted'
    | 'invoice.payment_failed';

const EVENT_TYPES: readonly WebhookEventType[] = [
    'checkout.session.completed',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'invoice.payment_failed',
];

interface GeneratedEvent {
    stripeEvent: any;
    /** The Stripe subscription object returned by subscriptions.retrieve (for checkout events). */
    stripeSubscription?: { id: string; items: { data: [{ price: { id: string } }] } };
}

function generateEvent(rand: () => number, idx: number): GeneratedEvent {
    const type = pick(EVENT_TYPES, rand);
    const priceId = pick(PRICE_IDS, rand);
    const status = pick(SUB_STATUSES, rand);

    switch (type) {
        case 'checkout.session.completed':
            return {
                stripeEvent: {
                    id: `evt_${idx}`,
                    type,
                    data: {
                        object: {
                            metadata: { user_id: USER_ID },
                            subscription: SUB_ID,
                        },
                    },
                },
                stripeSubscription: {
                    id: SUB_ID,
                    items: { data: [{ price: { id: priceId } }] },
                },
            };

        case 'customer.subscription.updated':
            return {
                stripeEvent: {
                    id: `evt_${idx}`,
                    type,
                    data: { object: { customer: CUSTOMER_ID, status } },
                },
            };

        case 'customer.subscription.deleted':
            return {
                stripeEvent: {
                    id: `evt_${idx}`,
                    type,
                    data: { object: { customer: CUSTOMER_ID } },
                },
            };

        case 'invoice.payment_failed':
            return {
                stripeEvent: {
                    id: `evt_${idx}`,
                    type,
                    data: { object: { customer: CUSTOMER_ID } },
                },
            };
    }
}

// ── Reference model ───────────────────────────────────────────────────────────
//
// Pure function: given current state + event, returns next state.
// This is the spec — it must NOT share code with the implementation.

function applyEvent(state: ProfileState, event: GeneratedEvent): ProfileState {
    const type: WebhookEventType = event.stripeEvent.type;

    switch (type) {
        case 'checkout.session.completed': {
            const priceId = event.stripeSubscription!.items.data[0].price.id;
            const tier = PRICE_TO_TIER[priceId] ?? 'free';
            return {
                subscription_tier: tier,
                subscription_status: 'active',
                stripe_subscription_id: SUB_ID,
            };
        }

        case 'customer.subscription.updated': {
            const status = event.stripeEvent.data.object.status;
            return { ...state, subscription_status: status };
        }

        case 'customer.subscription.deleted':
            return {
                subscription_tier: 'free',
                subscription_status: 'canceled',
                stripe_subscription_id: null,
            };

        case 'invoice.payment_failed':
            return { ...state, subscription_status: 'past_due' };
    }
}

function runReferenceModel(
    initial: ProfileState,
    events: GeneratedEvent[]
): ProfileState {
    return events.reduce(applyEvent, initial);
}

// ── Supabase captured-writes mock ─────────────────────────────────────────────
//
// We maintain a mutable `capturedDb` object that the mock writes into.
// The mock is injected via the module-level `supabaseFactory` variable so
// each test iteration can swap in a fresh state without re-mocking.

let capturedDb: ProfileState = {
    subscription_tier: 'free',
    subscription_status: 'active',
    stripe_subscription_id: null,
};

let supabaseFactory: () => any = () => ({});

function makeSupabaseMock(db: ProfileState, userId: string, customerId: string) {
    return () => ({
        auth: { getUser: vi.fn() },
        from: (table: string) => {
            if (table !== 'profiles') return {};

            return {
                // select().eq('stripe_customer_id', ...).single()
                // select().eq('id', ...).single()
                select: () => ({
                    eq: (_col: string, _val: string) => ({
                        single: () =>
                            Promise.resolve({ data: { id: userId }, error: null }),
                    }),
                }),
                // update(patch).eq('id', userId)
                update: (patch: Partial<ProfileState>) => ({
                    eq: (_col: string, _val: string) => {
                        Object.assign(db, patch);
                        return Promise.resolve({ error: null });
                    },
                }),
            };
        },
    });
}

// ── Import service ────────────────────────────────────────────────────────────

import { PaymentService } from './payment.service';

// ── Property test ─────────────────────────────────────────────────────────────

const ITERATIONS = 100;
const BASE_SEED = 0xdeadbeef;

describe('Property 5 – Subscription Webhook Synchronization', () => {
    beforeEach(() => vi.clearAllMocks());

    it(
        `final DB state matches reference model across ${ITERATIONS} random event sequences`,
        async () => {
            for (let i = 0; i < ITERATIONS; i++) {
                const rand = makePrng(BASE_SEED + i);

                // ── Generate initial profile state ────────────────────────────
                const initial: ProfileState = {
                    subscription_tier: pick(TIERS, rand),
                    subscription_status: pick(SUB_STATUSES, rand),
                    stripe_subscription_id: rand() > 0.4 ? SUB_ID : null,
                };

                // ── Generate event sequence (1–8 events) ─────────────────────
                const seqLen = 1 + Math.floor(rand() * 8);
                const events: GeneratedEvent[] = Array.from({ length: seqLen }, (_, j) =>
                    generateEvent(rand, i * 100 + j)
                );

                // ── Reference model ───────────────────────────────────────────
                const expected = runReferenceModel(initial, events);

                // ── System under test ─────────────────────────────────────────
                capturedDb = { ...initial };
                supabaseFactory = makeSupabaseMock(capturedDb, USER_ID, CUSTOMER_ID);

                // Wire stripe.subscriptions.retrieve for checkout events
                mockSubscriptionsRetrieve.mockImplementation((_subId: string) => {
                    // Find the most recent checkout event's subscription object
                    const last = [...events]
                        .reverse()
                        .find((e) => e.stripeEvent.type === 'checkout.session.completed');
                    return Promise.resolve(last?.stripeSubscription ?? { id: SUB_ID, items: { data: [{ price: { id: 'price_pro' } }] } });
                });

                const service = new PaymentService();
                for (const event of events) {
                    await service.handleWebhook(event.stripeEvent);
                }

                // ── Assert ────────────────────────────────────────────────────
                expect(capturedDb.subscription_tier).toBe(expected.subscription_tier);
                expect(capturedDb.subscription_status).toBe(expected.subscription_status);
                expect(capturedDb.stripe_subscription_id).toBe(expected.stripe_subscription_id);
            }
        },
        // Allow up to 15 s for 100 async iterations
        15_000
    );

    // ── Targeted invariant checks ─────────────────────────────────────────────
    // These run specific sequences to pin known-important state transitions.

    it('checkout.session.completed always sets tier from price and status=active', async () => {
        for (const priceId of PRICE_IDS) {
            capturedDb = { subscription_tier: 'free', subscription_status: 'canceled', stripe_subscription_id: null };
            supabaseFactory = makeSupabaseMock(capturedDb, USER_ID, CUSTOMER_ID);

            const sub = { id: SUB_ID, items: { data: [{ price: { id: priceId } }] } };
            mockSubscriptionsRetrieve.mockResolvedValue(sub);

            const service = new PaymentService();
            await service.handleWebhook({
                id: 'evt_targeted_1',
                type: 'checkout.session.completed',
                data: { object: { metadata: { user_id: USER_ID }, subscription: SUB_ID } },
            } as any);

            expect(capturedDb.subscription_tier).toBe(PRICE_TO_TIER[priceId]);
            expect(capturedDb.subscription_status).toBe('active');
            expect(capturedDb.stripe_subscription_id).toBe(SUB_ID);
        }
    });

    it('customer.subscription.deleted always resets to free/canceled/null regardless of prior state', async () => {
        for (const tier of TIERS) {
            capturedDb = { subscription_tier: tier, subscription_status: 'active', stripe_subscription_id: SUB_ID };
            supabaseFactory = makeSupabaseMock(capturedDb, USER_ID, CUSTOMER_ID);

            const service = new PaymentService();
            await service.handleWebhook({
                id: 'evt_targeted_2',
                type: 'customer.subscription.deleted',
                data: { object: { customer: CUSTOMER_ID } },
            } as any);

            expect(capturedDb.subscription_tier).toBe('free');
            expect(capturedDb.subscription_status).toBe('canceled');
            expect(capturedDb.stripe_subscription_id).toBeNull();
        }
    });

    it('invoice.payment_failed always sets status=past_due without changing tier or subscription ID', async () => {
        for (const tier of TIERS) {
            capturedDb = { subscription_tier: tier, subscription_status: 'active', stripe_subscription_id: SUB_ID };
            supabaseFactory = makeSupabaseMock(capturedDb, USER_ID, CUSTOMER_ID);

            const service = new PaymentService();
            await service.handleWebhook({
                id: 'evt_targeted_3',
                type: 'invoice.payment_failed',
                data: { object: { customer: CUSTOMER_ID } },
            } as any);

            expect(capturedDb.subscription_status).toBe('past_due');
            // Tier and subscription ID must be untouched
            expect(capturedDb.subscription_tier).toBe(tier);
            expect(capturedDb.stripe_subscription_id).toBe(SUB_ID);
        }
    });

    it('deleted then checkout restores paid tier (resurrection sequence)', async () => {
        capturedDb = { subscription_tier: 'pro', subscription_status: 'active', stripe_subscription_id: SUB_ID };
        supabaseFactory = makeSupabaseMock(capturedDb, USER_ID, CUSTOMER_ID);
        mockSubscriptionsRetrieve.mockResolvedValue({
            id: SUB_ID,
            items: { data: [{ price: { id: 'price_ent' } }] },
        });

        const service = new PaymentService();

        await service.handleWebhook({
            id: 'evt_del',
            type: 'customer.subscription.deleted',
            data: { object: { customer: CUSTOMER_ID } },
        } as any);

        expect(capturedDb.subscription_tier).toBe('free');

        await service.handleWebhook({
            id: 'evt_checkout',
            type: 'checkout.session.completed',
            data: { object: { metadata: { user_id: USER_ID }, subscription: SUB_ID } },
        } as any);

        expect(capturedDb.subscription_tier).toBe('enterprise');
        expect(capturedDb.subscription_status).toBe('active');
        expect(capturedDb.stripe_subscription_id).toBe(SUB_ID);
    });
});
