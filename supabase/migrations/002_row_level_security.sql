-- ============================================================
-- Migration 002: Row-Level Security Policies
-- ============================================================
-- User identity is established via auth.uid() which returns the
-- UUID of the currently authenticated Supabase/JWT user.
-- The service_role key bypasses ALL RLS policies by design —
-- server-side API routes use it for writes that cross user
-- boundaries (e.g. inserting deployment logs on behalf of a user).
-- ============================================================

-- Enable Row Level Security on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployment_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE customization_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployment_analytics ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- profiles
-- Protects: personal subscription info, Stripe IDs, GitHub token.
-- Identity: auth.uid() must equal the row's primary key (id).
-- Edge cases:
--   • No DELETE policy — profiles are deleted via CASCADE from
--     auth.users, not directly by the user.
--   • Service role can read/write all rows for webhook handlers.
-- ============================================================
CREATE POLICY "Users can view own profile" ON profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles
    FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

-- ============================================================
-- deployments
-- Protects: per-user deployment records including repo/Vercel IDs.
-- Identity: auth.uid() must equal user_id foreign key.
-- Edge cases: all four DML operations are covered.
-- ============================================================
CREATE POLICY "Users can view own deployments" ON deployments
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own deployments" ON deployments
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own deployments" ON deployments
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own deployments" ON deployments
    FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- deployment_logs
-- Protects: build/runtime logs that may contain secrets.
-- Identity: indirect — row's deployment_id must belong to a
--   deployment owned by auth.uid().
-- Edge cases:
--   • INSERT uses WITH CHECK (true) so the server-side pipeline
--     (running with service_role) can write logs without needing
--     to impersonate the user.  This is intentional: the service
--     role is trusted; anon/authenticated roles cannot insert
--     because service_role bypasses RLS entirely.
--   • No UPDATE or DELETE policies — logs are append-only.
-- ============================================================
CREATE POLICY "Users can view logs for own deployments" ON deployment_logs
    FOR SELECT USING (
        deployment_id IN (
            SELECT id FROM deployments WHERE user_id = auth.uid()
        )
    );

-- FINDING: WITH CHECK (true) allows any authenticated user to insert
-- logs for any deployment_id.  Mitigated in practice by the fact that
-- all log writes go through the service_role path, but a compromised
-- authenticated token could pollute another user's logs.
-- Recommendation: tighten to match the SELECT policy, or rely solely
-- on service_role for inserts and drop this policy.
CREATE POLICY "System can insert deployment logs" ON deployment_logs
    FOR INSERT WITH CHECK (true);

-- ============================================================
-- customization_drafts
-- Protects: saved UI customization state per user/template.
-- Identity: auth.uid() must equal user_id.
-- Edge cases: full CRUD covered.
-- ============================================================
CREATE POLICY "Users can view own drafts" ON customization_drafts
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own drafts" ON customization_drafts
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own drafts" ON customization_drafts
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own drafts" ON customization_drafts
    FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- deployment_analytics
-- Protects: per-deployment metrics.
-- Identity: indirect — deployment_id must belong to auth.uid().
-- Edge cases:
--   • INSERT WITH CHECK (true) — same trade-off as deployment_logs.
--     Any authenticated user can insert a metric row for any
--     deployment_id.  Acceptable only because analytics writes are
--     server-side (service_role); flag as a finding for hardening.
--   • No UPDATE or DELETE — metrics are immutable once recorded.
-- ============================================================
CREATE POLICY "Users can view analytics for own deployments" ON deployment_analytics
    FOR SELECT USING (
        deployment_id IN (
            SELECT id FROM deployments WHERE user_id = auth.uid()
        )
    );

-- FINDING: same overly-permissive INSERT as deployment_logs above.
CREATE POLICY "System can insert analytics" ON deployment_analytics
    FOR INSERT WITH CHECK (true);

-- ============================================================
-- templates
-- Protects: template catalogue (not user-specific data).
-- Identity: none required for SELECT — intentionally public.
-- Edge cases:
--   • Only active templates are visible to regular users.
--   • The service_role policy uses auth.jwt()->>'role' = 'service_role'
--     which is set by Supabase when the service key is used.
--   • No authenticated-user write policies — templates are
--     platform-managed, not user-managed.
-- ============================================================
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active templates" ON templates
    FOR SELECT USING (is_active = true);

CREATE POLICY "Service role can manage templates" ON templates
    FOR ALL USING (auth.jwt()->>'role' = 'service_role');
