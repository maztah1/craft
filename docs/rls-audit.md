# RLS Audit — CRAFT Platform

> Issue #235 · Audited 2026-03-29

## Summary Table

| Table                  | RLS Enabled | Policies (ops)                                      | Findings                                                                                  |
|------------------------|-------------|-----------------------------------------------------|-------------------------------------------------------------------------------------------|
| `profiles`             | ✅           | SELECT, UPDATE, INSERT (own row only)               | No DELETE policy — intentional (cascade from auth.users). ✅                              |
| `deployments`          | ✅           | SELECT, INSERT, UPDATE, DELETE (own rows only)      | Full CRUD covered. ✅                                                                      |
| `deployment_logs`      | ✅           | SELECT (own deployments), INSERT `WITH CHECK (true)`| ⚠️ **FINDING F-1**: INSERT allows any authed user to write logs for any deployment_id.    |
| `customization_drafts` | ✅           | SELECT, INSERT, UPDATE, DELETE (own rows only)      | Full CRUD covered. ✅                                                                      |
| `deployment_analytics` | ✅           | SELECT (own deployments), INSERT `WITH CHECK (true)`| ⚠️ **FINDING F-2**: INSERT allows any authed user to write metrics for any deployment_id. |
| `templates`            | ✅           | SELECT (active only), ALL (service_role only)       | Intentionally public read. Service-role write is correct. ✅                               |

---

## Findings

### F-1 — `deployment_logs`: overly-permissive INSERT

**Policy**: `"System can insert deployment logs"` — `WITH CHECK (true)`

**Risk**: Any authenticated user can insert a log row with an arbitrary `deployment_id`, including one belonging to another user. This could pollute another user's log stream or be used to inject misleading log entries.

**Mitigation in practice**: All log writes in the application go through the service_role key, which bypasses RLS entirely. The policy is therefore never exercised by normal application code.

**Recommendation**: Either drop the policy entirely (rely on service_role bypass) or tighten it:

```sql
-- Option A: drop — service_role writes bypass RLS anyway
DROP POLICY "System can insert deployment logs" ON deployment_logs;

-- Option B: restrict to own deployments (if user-side inserts are ever needed)
CREATE POLICY "Users can insert logs for own deployments" ON deployment_logs
    FOR INSERT WITH CHECK (
        deployment_id IN (SELECT id FROM deployments WHERE user_id = auth.uid())
    );
```

---

### F-2 — `deployment_analytics`: overly-permissive INSERT

**Policy**: `"System can insert analytics"` — `WITH CHECK (true)`

Same risk and recommendation as F-1. All analytics writes are server-side via service_role.

---

## Policy Details

### `profiles`

| Policy name                  | Op     | Expression                  |
|------------------------------|--------|-----------------------------|
| Users can view own profile   | SELECT | `auth.uid() = id`           |
| Users can update own profile | UPDATE | `auth.uid() = id`           |
| Users can insert own profile | INSERT | `auth.uid() = id`           |

User identity: `auth.uid()` compared to the row's primary key (`id`, which mirrors `auth.users.id`).

---

### `deployments`

| Policy name                    | Op     | Expression                  |
|--------------------------------|--------|-----------------------------|
| Users can view own deployments | SELECT | `auth.uid() = user_id`      |
| Users can create own deployments | INSERT | `auth.uid() = user_id`    |
| Users can update own deployments | UPDATE | `auth.uid() = user_id`    |
| Users can delete own deployments | DELETE | `auth.uid() = user_id`    |

---

### `deployment_logs`

| Policy name                              | Op     | Expression                                                                 |
|------------------------------------------|--------|----------------------------------------------------------------------------|
| Users can view logs for own deployments  | SELECT | `deployment_id IN (SELECT id FROM deployments WHERE user_id = auth.uid())` |
| System can insert deployment logs ⚠️     | INSERT | `true`                                                                     |

---

### `customization_drafts`

| Policy name                  | Op     | Expression                  |
|------------------------------|--------|-----------------------------|
| Users can view own drafts    | SELECT | `auth.uid() = user_id`      |
| Users can create own drafts  | INSERT | `auth.uid() = user_id`      |
| Users can update own drafts  | UPDATE | `auth.uid() = user_id`      |
| Users can delete own drafts  | DELETE | `auth.uid() = user_id`      |

---

### `deployment_analytics`

| Policy name                                    | Op     | Expression                                                                 |
|------------------------------------------------|--------|----------------------------------------------------------------------------|
| Users can view analytics for own deployments   | SELECT | `deployment_id IN (SELECT id FROM deployments WHERE user_id = auth.uid())` |
| System can insert analytics ⚠️                 | INSERT | `true`                                                                     |

---

### `templates`

| Policy name                      | Op  | Expression                                  |
|----------------------------------|-----|---------------------------------------------|
| Anyone can view active templates | SELECT | `is_active = true`                     |
| Service role can manage templates | ALL | `auth.jwt()->>'role' = 'service_role'`  |

Intentionally public: templates are platform-managed catalogue data, not user-specific.
