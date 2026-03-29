/**
 * RLS Policy Tests — Issue #235
 *
 * These tests simulate the Supabase RLS layer by applying the same
 * USING / WITH CHECK predicates that the real policies enforce.
 * Each table section covers:
 *   (a) owner access → allowed
 *   (b) other-user access → denied
 *   (c) unauthenticated access → denied
 *
 * Where a policy has a known finding (overly-permissive INSERT WITH CHECK (true))
 * the test documents the current behaviour AND the expected hardened behaviour.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal in-process RLS simulator
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

/**
 * Evaluates a USING / WITH CHECK predicate given a simulated auth context.
 * Returns true if the row passes the policy (access granted).
 */
function applyUsing(
    predicate: (row: Row, uid: string | null) => boolean,
    row: Row,
    uid: string | null
): boolean {
    return predicate(row, uid);
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const USER_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const USER_B = 'bbbbbbbb-0000-0000-0000-000000000002';
const ANON = null; // unauthenticated

const DEPLOYMENT_A = 'dddddddd-0000-0000-0000-000000000001';
const DEPLOYMENT_B = 'dddddddd-0000-0000-0000-000000000002';

/** Simulates the deployments table for indirect-join policies. */
const deploymentsTable: Row[] = [
    { id: DEPLOYMENT_A, user_id: USER_A },
    { id: DEPLOYMENT_B, user_id: USER_B },
];

function deploymentsBelongingTo(uid: string | null): string[] {
    if (!uid) return [];
    return deploymentsTable
        .filter((d) => d.user_id === uid)
        .map((d) => d.id as string);
}

// ---------------------------------------------------------------------------
// Predicates — mirror the SQL USING / WITH CHECK expressions exactly
// ---------------------------------------------------------------------------

const policies = {
    // profiles
    profiles_select: (row: Row, uid: string | null) => uid !== null && uid === row.id,
    profiles_update: (row: Row, uid: string | null) => uid !== null && uid === row.id,
    profiles_insert: (row: Row, uid: string | null) => uid !== null && uid === row.id,

    // deployments
    deployments_select: (row: Row, uid: string | null) => uid !== null && uid === row.user_id,
    deployments_insert: (row: Row, uid: string | null) => uid !== null && uid === row.user_id,
    deployments_update: (row: Row, uid: string | null) => uid !== null && uid === row.user_id,
    deployments_delete: (row: Row, uid: string | null) => uid !== null && uid === row.user_id,

    // deployment_logs — SELECT uses indirect join
    deployment_logs_select: (row: Row, uid: string | null) =>
        deploymentsBelongingTo(uid).includes(row.deployment_id as string),

    // FINDING F-1: current INSERT policy is WITH CHECK (true)
    deployment_logs_insert_current: (_row: Row, _uid: string | null) => true,

    // Hardened INSERT (recommended fix)
    deployment_logs_insert_hardened: (row: Row, uid: string | null) =>
        deploymentsBelongingTo(uid).includes(row.deployment_id as string),

    // customization_drafts
    drafts_select: (row: Row, uid: string | null) => uid !== null && uid === row.user_id,
    drafts_insert: (row: Row, uid: string | null) => uid !== null && uid === row.user_id,
    drafts_update: (row: Row, uid: string | null) => uid !== null && uid === row.user_id,
    drafts_delete: (row: Row, uid: string | null) => uid !== null && uid === row.user_id,

    // deployment_analytics — SELECT uses indirect join
    analytics_select: (row: Row, uid: string | null) =>
        deploymentsBelongingTo(uid).includes(row.deployment_id as string),

    // FINDING F-2: current INSERT policy is WITH CHECK (true)
    analytics_insert_current: (_row: Row, _uid: string | null) => true,

    // Hardened INSERT (recommended fix)
    analytics_insert_hardened: (row: Row, uid: string | null) =>
        deploymentsBelongingTo(uid).includes(row.deployment_id as string),

    // templates
    templates_select: (row: Row, _uid: string | null) => row.is_active === true,
    templates_service_role: (_row: Row, role: string | null) => role === 'service_role',
};

// ---------------------------------------------------------------------------
// profiles
// ---------------------------------------------------------------------------

describe('RLS: profiles', () => {
    const ownRow: Row = { id: USER_A };
    const otherRow: Row = { id: USER_B };

    describe('SELECT', () => {
        it('(a) owner can read own profile', () => {
            expect(applyUsing(policies.profiles_select, ownRow, USER_A)).toBe(true);
        });
        it('(b) other user cannot read another profile', () => {
            expect(applyUsing(policies.profiles_select, otherRow, USER_A)).toBe(false);
        });
        it('(c) unauthenticated request is denied', () => {
            expect(applyUsing(policies.profiles_select, ownRow, ANON)).toBe(false);
        });
    });

    describe('UPDATE', () => {
        it('(a) owner can update own profile', () => {
            expect(applyUsing(policies.profiles_update, ownRow, USER_A)).toBe(true);
        });
        it('(b) other user cannot update another profile', () => {
            expect(applyUsing(policies.profiles_update, otherRow, USER_A)).toBe(false);
        });
        it('(c) unauthenticated request is denied', () => {
            expect(applyUsing(policies.profiles_update, ownRow, ANON)).toBe(false);
        });
    });

    describe('INSERT', () => {
        it('(a) user can insert their own profile row', () => {
            expect(applyUsing(policies.profiles_insert, ownRow, USER_A)).toBe(true);
        });
        it('(b) user cannot insert a profile row for another user', () => {
            expect(applyUsing(policies.profiles_insert, otherRow, USER_A)).toBe(false);
        });
        it('(c) unauthenticated request is denied', () => {
            expect(applyUsing(policies.profiles_insert, ownRow, ANON)).toBe(false);
        });
    });
});

// ---------------------------------------------------------------------------
// deployments
// ---------------------------------------------------------------------------

describe('RLS: deployments', () => {
    const ownRow: Row = { id: DEPLOYMENT_A, user_id: USER_A };
    const otherRow: Row = { id: DEPLOYMENT_B, user_id: USER_B };

    for (const [op, policy] of [
        ['SELECT', policies.deployments_select],
        ['INSERT', policies.deployments_insert],
        ['UPDATE', policies.deployments_update],
        ['DELETE', policies.deployments_delete],
    ] as const) {
        describe(op, () => {
            it('(a) owner can access own deployment', () => {
                expect(applyUsing(policy, ownRow, USER_A)).toBe(true);
            });
            it('(b) other user cannot access another deployment', () => {
                expect(applyUsing(policy, otherRow, USER_A)).toBe(false);
            });
            it('(c) unauthenticated request is denied', () => {
                expect(applyUsing(policy, ownRow, ANON)).toBe(false);
            });
        });
    }
});

// ---------------------------------------------------------------------------
// deployment_logs
// ---------------------------------------------------------------------------

describe('RLS: deployment_logs', () => {
    const ownLog: Row = { id: 'log-1', deployment_id: DEPLOYMENT_A };
    const otherLog: Row = { id: 'log-2', deployment_id: DEPLOYMENT_B };

    describe('SELECT', () => {
        it('(a) owner can read logs for own deployment', () => {
            expect(applyUsing(policies.deployment_logs_select, ownLog, USER_A)).toBe(true);
        });
        it('(b) other user cannot read logs for another deployment', () => {
            expect(applyUsing(policies.deployment_logs_select, otherLog, USER_A)).toBe(false);
        });
        it('(c) unauthenticated request is denied', () => {
            expect(applyUsing(policies.deployment_logs_select, ownLog, ANON)).toBe(false);
        });
    });

    describe('INSERT — current policy (WITH CHECK (true)) [FINDING F-1]', () => {
        it('allows any authenticated user to insert a log for any deployment_id', () => {
            // Documents the current (permissive) behaviour — this is the finding.
            expect(applyUsing(policies.deployment_logs_insert_current, otherLog, USER_A)).toBe(true);
        });
        it('even allows unauthenticated inserts at the policy level', () => {
            expect(applyUsing(policies.deployment_logs_insert_current, ownLog, ANON)).toBe(true);
        });
    });

    describe('INSERT — hardened policy (recommended fix)', () => {
        it('(a) owner can insert a log for own deployment', () => {
            expect(applyUsing(policies.deployment_logs_insert_hardened, ownLog, USER_A)).toBe(true);
        });
        it('(b) other user cannot insert a log for another deployment', () => {
            expect(applyUsing(policies.deployment_logs_insert_hardened, otherLog, USER_A)).toBe(false);
        });
        it('(c) unauthenticated request is denied', () => {
            expect(applyUsing(policies.deployment_logs_insert_hardened, ownLog, ANON)).toBe(false);
        });
    });
});

// ---------------------------------------------------------------------------
// customization_drafts
// ---------------------------------------------------------------------------

describe('RLS: customization_drafts', () => {
    const ownDraft: Row = { id: 'draft-1', user_id: USER_A };
    const otherDraft: Row = { id: 'draft-2', user_id: USER_B };

    for (const [op, policy] of [
        ['SELECT', policies.drafts_select],
        ['INSERT', policies.drafts_insert],
        ['UPDATE', policies.drafts_update],
        ['DELETE', policies.drafts_delete],
    ] as const) {
        describe(op, () => {
            it('(a) owner can access own draft', () => {
                expect(applyUsing(policy, ownDraft, USER_A)).toBe(true);
            });
            it('(b) other user cannot access another draft', () => {
                expect(applyUsing(policy, otherDraft, USER_A)).toBe(false);
            });
            it('(c) unauthenticated request is denied', () => {
                expect(applyUsing(policy, ownDraft, ANON)).toBe(false);
            });
        });
    }
});

// ---------------------------------------------------------------------------
// deployment_analytics
// ---------------------------------------------------------------------------

describe('RLS: deployment_analytics', () => {
    const ownMetric: Row = { id: 'metric-1', deployment_id: DEPLOYMENT_A };
    const otherMetric: Row = { id: 'metric-2', deployment_id: DEPLOYMENT_B };

    describe('SELECT', () => {
        it('(a) owner can read analytics for own deployment', () => {
            expect(applyUsing(policies.analytics_select, ownMetric, USER_A)).toBe(true);
        });
        it('(b) other user cannot read analytics for another deployment', () => {
            expect(applyUsing(policies.analytics_select, otherMetric, USER_A)).toBe(false);
        });
        it('(c) unauthenticated request is denied', () => {
            expect(applyUsing(policies.analytics_select, ownMetric, ANON)).toBe(false);
        });
    });

    describe('INSERT — current policy (WITH CHECK (true)) [FINDING F-2]', () => {
        it('allows any authenticated user to insert a metric for any deployment_id', () => {
            expect(applyUsing(policies.analytics_insert_current, otherMetric, USER_A)).toBe(true);
        });
        it('even allows unauthenticated inserts at the policy level', () => {
            expect(applyUsing(policies.analytics_insert_current, ownMetric, ANON)).toBe(true);
        });
    });

    describe('INSERT — hardened policy (recommended fix)', () => {
        it('(a) owner can insert a metric for own deployment', () => {
            expect(applyUsing(policies.analytics_insert_hardened, ownMetric, USER_A)).toBe(true);
        });
        it('(b) other user cannot insert a metric for another deployment', () => {
            expect(applyUsing(policies.analytics_insert_hardened, otherMetric, USER_A)).toBe(false);
        });
        it('(c) unauthenticated request is denied', () => {
            expect(applyUsing(policies.analytics_insert_hardened, ownMetric, ANON)).toBe(false);
        });
    });
});

// ---------------------------------------------------------------------------
// templates (public read, service-role write)
// ---------------------------------------------------------------------------

describe('RLS: templates', () => {
    const activeTemplate: Row = { id: 'tmpl-1', is_active: true };
    const inactiveTemplate: Row = { id: 'tmpl-2', is_active: false };

    describe('SELECT (public — no auth required)', () => {
        it('active template is visible to any user', () => {
            expect(applyUsing(policies.templates_select, activeTemplate, USER_A)).toBe(true);
        });
        it('active template is visible even when unauthenticated', () => {
            expect(applyUsing(policies.templates_select, activeTemplate, ANON)).toBe(true);
        });
        it('inactive template is hidden from all users', () => {
            expect(applyUsing(policies.templates_select, inactiveTemplate, USER_A)).toBe(false);
        });
        it('inactive template is hidden from unauthenticated requests', () => {
            expect(applyUsing(policies.templates_select, inactiveTemplate, ANON)).toBe(false);
        });
    });

    describe('ALL (service_role only)', () => {
        it('service_role can manage templates', () => {
            expect(applyUsing(policies.templates_service_role, activeTemplate, 'service_role')).toBe(true);
        });
        it('regular authenticated user cannot manage templates', () => {
            expect(applyUsing(policies.templates_service_role, activeTemplate, USER_A)).toBe(false);
        });
        it('unauthenticated request cannot manage templates', () => {
            expect(applyUsing(policies.templates_service_role, activeTemplate, ANON)).toBe(false);
        });
    });
});
