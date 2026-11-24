# VERITY Institution Expansion — Backward-Compatible Architecture Decision

**Status:** Approved for isolated implementation planning  
**Branch:** `feature/institution-expansion-backward-compatible`  
**Baseline:** Existing `main` branch and current production Supabase schema, audited 2026-11-24  
**Release rule:** No production deployment or production migration as part of this branch until isolated implementation, regression checks, and an explicit release review are complete.

## 1. Objective

Extend VERITY to support secondary schools, vocational/training providers, professional bodies, and eligible organizations that issue credentials, while preserving the existing University and large-organization workflows.

This is an additive product expansion. It is not a rebuild and must not replace the current authentication, organization approval, membership, roster, certificate, ledger, verification, consent, or audit foundations.

## 2. Verified baseline

The current application and production schema already contain:

- `Organization` with the existing `type` values used by issuer/verifier authorization, approval status, owner, registration details, and directory visibility.
- `Membership` for a user-to-organization relationship.
- `StudentRoster` with `studentNumber`, normalized student number, official name, claim state, import batch, and award metadata.
- `StudentActivationToken` and `StudentRegistrationRecovery` for token-backed activation and controlled ICT recovery.
- `Certificate`, `CertificateLedger`, `Verification`, document access grants, issuance queues, and audit events.
- Server registration and issuer paths that currently distinguish `INSTITUTION` from `EMPLOYER`.
- Student registration precheck and activation RPCs that currently match a roster by `studentNumber`.

These are existing contracts. Do not rename or remove them during the expansion.

## 3. Compatibility architecture

### 3.1 Preserve organization authorization semantics

Keep the current `Organization.type` authorization meaning intact:

- `INSTITUTION` continues to mean an approved credential issuer.
- `EMPLOYER` continues to mean an approved credential verifier.

Do not introduce new values into this authorization discriminator merely to represent a school or training-provider category. Existing routes, RLS policies, staff permission checks, public directory functions, and issuer lookups rely on its current meaning.

Add a separate organization classification field (proposed name: `institutionCategory`) for the kind of issuer:

- `HIGHER_EDUCATION` — existing universities and higher-education institutions.
- `SECONDARY_SCHOOL` — secondary schools.
- `VOCATIONAL_TRAINING` — vocational, technical and skills-training providers.
- `PROFESSIONAL_BODY` — professional and certification bodies.
- `CORPORATE_ISSUER` — companies/organizations issuing their own training or professional credentials.

Existing records must remain valid without requiring a destructive rewrite. Reads should interpret a missing category as the legacy higher-education category until an owner/admin explicitly confirms a more accurate classification.

Existing employer/verifier organizations remain `EMPLOYER`; they are not silently converted into issuers. If a company needs both verification and issuance capabilities, model that as an explicit, reviewed capability rather than changing its existing type or granting issuer permissions by default.

### 3.2 Institution-defined identity labels

Retain the stable internal VERITY user ID as the account identity. A school's or issuer's identifier is an external, organization-scoped identifier and is not globally unique.

Add configuration for the identifier label and optional format rules. Initial labels should include:

- Matriculation Number
- Admission Number
- Student ID
- Learner ID
- Membership Number
- Employee ID
- Candidate Number
- Custom label

Keep the existing `studentNumber` and `normalizedStudentNumber` columns as compatibility fields during the transition. New generic identifier fields may be added additively and dual-written for legacy-compatible student records. Do not rename/drop legacy columns or change existing certificate payloads in the first rollout.

Uniqueness must be scoped to the issuing organization, using a normalized value. Do not assume an identifier is unique across VERITY.

The user interface should display the configured label while internal APIs retain compatible field names until every reader, writer, RPC and test has been migrated.

### 3.3 Status-aware registration

Registration must be driven by the approved issuer's category and roster policy, not by a user-selected role or a self-asserted identifier.

- Existing University graduate registration remains unchanged.
- Secondary-school learners and training/professional participants use the same underlying account and claim model, with terminology adapted to the issuer's configured identity label.
- An account may exist before its issuer membership is activated; an identifier alone never proves ownership.
- Existing single-use activation-token rules remain in force.
- Existing institution ICT recovery and two-person review remain in force.
- Issuer owners and authorized staff manage only their own organization's roster.
- Employer/verifier accounts continue to use the existing graduate-consent verification process.

Do not force every secondary-school learner to have an email address in the imported roster. Keep delivery/identity proof separate from the identifier and require the issuer's approved activation process.

### 3.4 Roster import

Extend the current CSV/XLSX workflow rather than creating a second importer.

- Provide a template generated from the organization's selected identifier label.
- Support column mapping for identifier, full name, and optional email, cohort/session, class/department/programme, and credential-related fields.
- Validate required columns, empty identifiers, duplicate identifiers within the upload, duplicates already in the organization's roster, malformed rows and file limits before submission.
- Show a preview and row-level outcomes before the issuer confirms import.
- Preserve the existing durable queue, chunk processing, audit trail, retries and import history.
- Keep imports private to the issuer and its authorized roster staff.
- Never auto-create accounts or issue credentials simply because a row was imported.

### 3.5 Issuer capability and approval

VERITY approval is a platform onboarding decision; it is not regulatory accreditation.

- Preserve the existing institution approval workflow.
- Add category-specific evidence requirements as configuration, not hard-coded assumptions that every issuer is regulated by the same authority.
- A professional body, school or company must not receive an accreditation claim merely because it has a VERITY account.
- Distinguish platform identity review from any external accreditation/recognition claim.
- A verifier-only employer remains verifier-only.
- Any future dual issuer/verifier capability requires explicit admin review and server-side authorization.

## 4. Data and migration rules

All database changes must be additive and reversible where practical:

1. Add nullable/defaulted classification and identifier configuration fields without renaming existing columns.
2. Add generic identifier storage fields only after inspecting all current unique indexes, RPCs, triggers, RLS policies and queue consumers.
3. Backfill only where deterministic and demonstrably safe; otherwise use read-time legacy fallbacks.
4. Preserve existing row IDs, user IDs, memberships, certificate IDs, verification keys, hashes, ledger entries and audit history.
5. Never recalculate historical certificate fingerprints as part of this expansion.
6. Never rewrite or delete existing production migration history.
7. Do not apply a migration to production from this feature branch.

## 5. Implementation phases

### Phase A — foundation and classification
- Add category and identity configuration to organization onboarding and admin review.
- Keep legacy organizations on their current behavior.
- Add tests proving current issuer/verifier type semantics are unchanged.

### Phase B — generic identity compatibility layer
- Implement organization-scoped external identifier normalization and validation.
- Dual-read/dual-write legacy student number fields as required.
- Update precheck, activation, membership and recovery flows without weakening the existing token or two-person controls.

### Phase C — flexible roster import
- Add dynamic CSV/XLSX column mapping, templates, preview, validation and row-level reporting.
- Reuse the existing durable roster import queue and preserve worker idempotency.

### Phase D — tailored experience
- Update registration, roster management, membership views and user guidelines to use configured labels and category-appropriate terminology.
- Keep the existing University interface wording and workflow unchanged by default.

### Phase E — validation and release
- Run unit, API, database, RLS/RPC, import-worker and build tests.
- Add regression coverage for existing University registration, student activation, certificate issuance, revocation, graduate access, employer verification, consent and public verification.
- Review migration drift and production schema before any release proposal.
- Prepare a release PR and deployment plan. Production release requires a separate explicit approval.

## 6. Non-negotiable regression guarantees

- Existing University and large-organization users can continue their current workflows.
- Existing `INSTITUTION` and `EMPLOYER` meanings do not change.
- Existing student-number imports and templates continue to work.
- Existing activation tokens remain single-use and organization-scoped.
- Existing ICT recovery remains two-person for active-account release.
- Existing certificate records, hashes, ledger chain, QR references and verification URLs remain unchanged.
- Existing graduate consent and verifier access rules remain unchanged.
- Blockchain remains optional and disabled; no new workflow depends on wallets, gas, RPC endpoints or chain availability.
- No live student records or production test certificates are created for testing.

## 7. Out of scope for this rollout

- Historical certificate scan conversion/digitization.
- Regulatory accreditation or legal recognition claims.
- Automatic approval of newly added issuer categories.
- Automatic migration of existing employer organizations into issuer organizations.
- Replacing Supabase as the source of truth.
- Enabling blockchain anchoring.
- Destructive schema changes or changes to existing certificate identity/hash formats.

## 8. Completion criteria

The expansion is complete only when the new categories can onboard and operate through the shared credential lifecycle, configurable identifiers work end-to-end, roster import is reliable, existing University/employer regression tests pass, documentation is updated, and the release has been reviewed. A merged branch or successful frontend build alone is not proof of production readiness.


## 9. Implementation progress (isolated feature branch)

The first code slice adds reusable server-side identity primitives:

- Supported issuer-category constants and strict category validation.
- Preset/custom identifier-label validation.
- A shared organization-scoped identifier normalizer (Unicode NFKC, trim, uppercase, whitespace removal, control-character rejection).
- The existing CSV roster import now uses the shared normalizer while retaining its current accepted CSV column names and the existing `studentNumber` / `normalizedStudentNumber` persistence contract.
- Unit tests cover supported categories, Unicode normalization, invalid identifiers, and custom label validation.

This is intentionally a compatibility-first foundation, not the complete user-facing feature. It does not yet persist category/identifier configuration, alter registration or activation RPC parameters, add configurable CSV column mapping, or expose new categories in onboarding. Those steps require a reviewed additive Supabase migration and coordinated server/UI changes.

## 10. Tooling and verification gate

The current connected environment provides GitHub file operations and production Supabase SQL access, but no local repository checkout or Supabase CLI executable. The Supabase workflow requires creating migration files with the CLI, validating locally, running advisors, and testing before migration release. Therefore no migration file has been fabricated, no production DDL has been executed, and no claim of a passing test run is made here. The feature branch should remain isolated until a proper local/CI migration workflow is available.


## 11. Production contract re-check (read-only, 2026-11-24)

A follow-up read-only inspection of the live Supabase schema confirmed the compatibility boundary:

- `Organization` currently has its authorization `type`, ownership, approval, registration, directory and location fields; it has no persisted issuer-category or identifier-label configuration yet.
- `StudentRoster` currently requires `studentNumber`, `normalizedStudentNumber`, `fullName`, `organizationId` and `createdBy`. Its optional metadata includes institutional email, faculty, department, programme, academic session, qualification, classification and award date.
- `Membership` stores `organizationId`, `userId`, optional `studentNumber` and status.
- `StudentActivationToken` is organization- and roster-scoped and stores a token hash, last four characters, issuer, expiry, used and revoked timestamps.
- `StudentRegistrationRecovery` retains the organization/roster scope and the second-review fields.
- Existing public RPC signatures include `verity_student_registration_precheck(p_organization_id text, p_student_number text) returns boolean` and `request_verity_membership(p_registration_code text, p_student_number text) returns jsonb`.

This confirms that configurable labels cannot be treated as a UI-only change: the registration precheck, membership request and activation/claim path must be evolved together while retaining their legacy signatures or providing explicit compatibility wrappers. No DDL or production data was changed during this inspection.
