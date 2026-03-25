# Implementation Plan: customization-payload-tests

## Overview

Add service-layer unit tests and property-based tests for `CustomizationDraftService` and `normalizeDraftConfig`. Two files are touched: the existing `customization-draft.service.test.ts` (extended with three new `describe` blocks) and a new `customization-draft.service.property.test.ts`.

## Tasks

- [-] 1. Extend `apps/web/src/services/customization-draft.service.test.ts` with service-layer unit tests
  - Add Supabase mock chain setup (`mockSingle`, `mockSelect`, `mockEq`, `mockUpsert`, `mockFrom`) at the top of the file using `vi.mock('@/lib/supabase/server', ...)`
  - Import `CustomizationDraftService` alongside the existing `normalizeDraftConfig` import
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ] 1.1 Add `describe('saveDraft')` block with 4 tests
    - Test: returns a `CustomizationDraft` on success — configure `mockFrom` for template lookup (returns `fakeRow`-style template) and upsert (returns `fakeRow`), assert returned object has `id`, `userId`, `templateId`, `customizationConfig`
    - Test: throws `'Template not found'` when template lookup returns an error — configure `mockSingle` to resolve `{ data: null, error: { message: 'not found' } }` for the templates chain
    - Test: throws `'Failed to save draft: ...'` when upsert errors — template lookup succeeds, upsert `mockSingle` resolves `{ data: null, error: { message: 'db error' } }`
    - Test: passes `onConflict: 'user_id,template_id'` to upsert — spy on `mockUpsert` and assert it was called with the correct second argument
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ] 1.2 Add `describe('getDraft')` block with 3 tests
    - Test: returns normalized draft when row exists — `mockSingle` resolves `{ data: fakeRow, error: null }`, assert `customizationConfig` is the normalized output of `normalizeDraftConfig(fakeRow.customization_config)`
    - Test: returns `null` on PGRST116 error — `mockSingle` resolves `{ data: null, error: { code: 'PGRST116' } }`
    - Test: throws `'Failed to get draft: ...'` on other errors — `mockSingle` resolves `{ data: null, error: { code: 'OTHER', message: 'boom' } }`
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 1.3 Add `describe('getDraftByDeployment')` block with 2 tests
    - Test: throws `'Forbidden'` when deployment `user_id` mismatches — `mockSingle` resolves `{ data: { template_id: templateId, user_id: 'other-user' }, error: null }` for the deployments query
    - Test: returns `null` when deployment not found — `mockSingle` resolves `{ data: null, error: { code: 'PGRST116' } }` for the deployments query
    - _Requirements: 2.4, 2.5_

- [ ] 2. Create `apps/web/src/services/customization-draft.service.property.test.ts`
  - Import `normalizeDraftConfig` from `./customization-draft.service`
  - Import `fc` from `fast-check`
  - Define arbitraries: `arbAnyInput` (covers `null`, `undefined`, `{}`, and partial/complete config objects), `arbCompleteConfig` (fully-populated config with all branding/features/stellar fields)
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ]* 2.1 Write property test for idempotence (Property 1)
    - **Property 1: normalizeDraftConfig is idempotent**
    - Assert `normalizeDraftConfig(normalizeDraftConfig(x))` deep-equals `normalizeDraftConfig(x)` for all `x` in `arbAnyInput`
    - Use `numRuns: 100`
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4**

  - [ ]* 2.2 Write property test for user-supplied values winning over defaults (Property 2)
    - **Property 2: user-supplied values always win over defaults**
    - For each field in `branding`, `features`, and `stellar`, assert the output value equals the input value when the input field is defined
    - Use `arbCompleteConfig` with `numRuns: 100`
    - **Validates: Requirements 3.5**

  - [ ]* 2.3 Write property test for structural completeness (Property 3)
    - **Property 3: output always has all required top-level keys**
    - Assert result has `branding`, `features`, and `stellar` keys, each a non-null object, for all `x` in `arbAnyInput`
    - Use `numRuns: 100`
    - **Validates: Requirements 3.2, 3.3, 3.4**

- [ ] 3. Checkpoint — Ensure all tests pass
  - Run `vitest --run` from `apps/web` and confirm all tests pass, including the existing `normalizeDraftConfig` tests. Ask the user if any questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Do NOT modify any already-passing test files (`validate.test.ts`, `validate-branding-file.test.ts`, route test files, etc.)
- The Supabase mock must be declared at module scope (outside `describe`) so `vi.mock` hoisting works correctly
- `beforeEach(() => vi.clearAllMocks())` should be added to reset mock state between tests
- Property tests use `fast-check` which is already installed in the monorepo
