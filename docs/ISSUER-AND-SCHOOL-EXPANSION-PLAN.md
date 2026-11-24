# VERITY Issuer and School Expansion — Implementation Plan

## Release objective

Extend VERITY so that primary and secondary schools, including one school operating both levels under one organization account, and eligible certificate-issuing organizations can use the existing credential workflows. Preserve existing university and verifier-organization behaviour.

This is an additive release. It must not replace the certificate engine, storage buckets, template system, student identity model, ledger, or bulk upload pipeline.

## Verified existing foundation

The current main branch contains:

- Organization accounts using the existing `INSTITUTION` and `EMPLOYER` organization types.
- Organization-wide approval status and supporting-evidence review.
- Institution-owned Certificate Design Studio, including VERITY templates and uploaded institutional artwork in PDF, PNG, or JPEG.
- Student-specific certificate fields and a template field-layout editor.
- A private `verity-certificates` storage bucket, document metadata, and SHA-256 integrity checks.
- Existing individual certificate issuance and revocation.
- Bulk issuance through CSV + ZIP of PDFs, CSV + multiple PDFs, or CSV-generated PDFs from the active approved design.
- CSV and XLSX student data import in the bulk issuance interface, with editable rows before submission.
- Durable PostgreSQL bulk issuance queue, per-item idempotency, retries, reconciliation, audit events, and the existing Supabase certificate ledger.
- Roster import, student activation-token registration, ICT permissions, and recovery workflows.

The current bulk-issuance implementation and database migration enforce a maximum of 500 rows per batch. This limit must not be raised by changing only the interface or one database constraint.

## Non-negotiable preservation boundary

The expansion must reuse the current sequence:

**Existing school data/uploads → existing bucket and field mapping → editable student-specific data → existing template/artwork → existing issuance and ledger → existing verification.**

Do not create a parallel upload wizard, replacement template editor, second certificate renderer, or separate student-data source.

Do not rename, move, delete, or make public any existing storage bucket or object. Do not rewrite existing certificate rows, digests, ledger events, verification keys, or historical document paths.

## Target organization model

Keep the existing organization type values as legacy business categories. Do not overload or rename them to encode new permissions.

Add explicit, independently reviewable organization capabilities:

- `ISSUE_CREDENTIALS`
- `VERIFY_CREDENTIALS`

An organization may request either capability or both. Each capability must be approved separately by a VERITY administrator. Organization approval remains a prerequisite; requesting or receiving one capability must not silently grant the other.

Backfill existing approved organizations without changing their access:
- Existing approved `INSTITUTION` organizations retain issuing access.
- Existing approved `EMPLOYER` organizations retain verification access.
- No existing organization receives a new capability merely because of this expansion.

For schools, store education levels on the same organization account:
- `PRIMARY`
- `SECONDARY`
- `TERTIARY`

A school selecting both primary and secondary must continue to have one organization owner, one approval record, one student/graduate registry, and one certificate workspace. Existing tertiary institutions must retain their current classification.

## Authorization requirements

- Every issuing route must require an approved organization and an approved `ISSUE_CREDENTIALS` capability.
- Every external-verification route must require an approved organization and an approved `VERIFY_CREDENTIALS` capability.
- A verification-only organization must never be able to issue, manage an issuer roster, activate graduates, edit certificate designs, upload issuer artwork, or access the issuance queue.
- An issuer-only organization must not gain external verifier privileges unless separately approved.
- Existing institution self-verification remains available under its current rules; it must not be confused with permission to verify another organization's credentials.
- Enforce all capability decisions in backend routes and database RLS/policies. Frontend visibility is not authorization.
- Preserve graduate consent before a verifier can view an original private certificate document.
- Preserve audit records for requests, approvals, suspensions, and capability use.

## School identity and student records

Use the existing organization-scoped roster, normalized student identifier, single-use activation token, graduate account, and ICT recovery workflows.

Support configurable human-facing identifier labels such as admission number, student number, matriculation number, employee number, or graduate/member number without changing the stable internal identity key or breaking existing university records.

A school with both primary and secondary levels must be able to distinguish the level and class/programme in its records while remaining within the same organization boundary. Do not silently reinterpret existing university faculty, department, or programme fields.

## Issuing-organization onboarding

Eligible organizations that issue certificates should be able to request `ISSUE_CREDENTIALS`. Their organization registration/identity review and issuer-capability review must be distinct decisions. The capability approval must not be inferred from the fact that an organization is already approved as a verifier.

The existing individual issuance, design, private document upload, bulk issuance, ledger, and verification flows should be reused after capability approval.

## Bulk capacity strategy

Do not assume a larger batch size is safe. The present limit of 500 is enforced in the browser, API validation, and PostgreSQL constraints/state counters.

Before scaling, measure:
- request and payload sizes;
- browser memory and XLSX/ZIP parsing time;
- private storage upload throughput;
- database staging and queue transaction duration;
- worker concurrency, processing latency, retries, and reconciliation;
- Render memory/CPU limits and service timeouts;
- Supabase database and storage limits.

The preferred scale-out path is to preserve the existing upload methods and split large school cycles into multiple resumable, independently auditable batches. Any future configurable per-batch cap must be derived from load tests and enforced consistently in the UI, API, storage staging, and database. Do not silently claim support for thousands in a single batch.

## Required regression gate

Before merging capability or school changes, test the current and expanded paths:

1. Existing university registration, approval, roster import, student activation, ICT permissions, recovery, and membership.
2. Existing certificate template creation, uploaded PDF/PNG/JPEG artwork, editable field layout, preview, activation, and template-generated PDF.
3. Existing individual issuance, document upload, QR verification, revocation, ledger integrity, and graduate consent.
4. Existing CSV + ZIP, CSV + multiple PDFs, and CSV-generated bulk issuance, including interruption, retry, duplicate prevention, reconciliation, and batch history.
5. Existing verifier-only organization lookup, consent request, and private-document access.
6. New primary-only, secondary-only, and combined primary/secondary school accounts.
7. New issuer-only organizations and separately approved dual-capability organizations.
8. Negative authorization tests proving that verifier-only organizations cannot access any issuing or roster-management path and issuer-only organizations cannot use external-verifier paths without approval.

## Implementation sequence

1. Keep work on an isolated feature branch; do not commit expansion changes directly to `main`.
2. Map the current organization schema, RLS policies, admin review UI, signup metadata, student directory RPCs, roster routes, certificate routes, template routes, and bulk queue end to end.
3. Add the capability and school-level data model as additive migrations with regression fixtures.
4. Add separately reviewable capability requests and administrator decisions.
5. Wire backend authorization and RLS to approved capabilities while preserving existing account access through explicit backfills.
6. Extend school onboarding and existing roster/graduate identity screens without creating a second registry.
7. Reuse the existing template/artwork/bucket and issuance workflows for newly approved issuers.
8. Add measured, resumable bulk-cycle scaling only after load tests.
9. Update README and User Guide only after implementation and tests match the documented behaviour.
10. Deploy migrations and application changes in a controlled sequence; keep new worker flags disabled until their prerequisites are verified.

## Current implementation status — feature branch

Implemented in `feature/issuer-capability-expansion`:

- Additive `Organization.educationLevels` metadata for PRIMARY, SECONDARY and TERTIARY, including one school account serving primary and secondary levels through mobile-friendly multi-select controls. Primary/secondary school identity review requires a registration number and supervising/accreditation body; a public website is optional, while tertiary institution requirements remain unchanged.
- `OrganizationCapability` records for independently requested and reviewed `ISSUE_CREDENTIALS` and `VERIFY_CREDENTIALS` permissions.
- Explicit baseline backfill preserving existing institution issuance and employer verification permissions; suspended organizations remain blocked by organization status and can be reinstated without losing their baseline capability.
- Organization-owner capability request/resubmission API and panel, plus a separate System Admin capability review API and panel.
- Organization approval integration that activates only the existing type's baseline capability; additional permissions still require a separate administrator decision.
- Capability-aware backend checks for student/graduate membership, roster imports, activation tokens, certificate design, individual/bulk issuance, document upload, QR generation, revocation, internal issuer verification, external verification, graduate-consented document access and registration-code management.
- Additive RLS and database-function migration for roster, issuance, verifier consent and private document access.
- Regression assertion fixtures for capability backfill, RLS policies, student onboarding functions, RPC execution privileges and preservation of the existing 500-item bulk-issuance limit.
- GitHub Actions PostgreSQL integration job applies both expansion migrations to an isolated PostgreSQL 16 database and executes the SQL assertions. The existing application build/test suite also passes on the validated feature-branch commit.
- README and User Guide updates.

Preservation boundary remains unchanged: the existing Certificate Design Studio, school-uploaded PDF/image artwork, bucket mapping, editable student-specific data, private storage locations, certificate renderer, three bulk-issuance methods, ledger records and existing batch limit are reused. No second upload system or certificate engine has been added.

Still required before merge or production use:

1. Run the migrations against a non-production Supabase project with the repository's real migration history and environment-specific extensions; the automated PostgreSQL 16 fixture is an isolated schema test, not a substitute for staging.
2. Exercise primary-only, secondary-only and combined schools; issuer-only, verifier-only and dual-capability organizations; and negative authorization cases with real Supabase Auth/RLS sessions.
3. Verify the existing template/artwork → bucket mapping → editable student data → PDF generation → ledger/verification path end to end. The existing Certificate Design Studio, uploaded PDF/image assets and editable per-student data remain the source of truth.
4. Confirm institution ICT delegation and registration-recovery behaviour. Non-academic issuer staff delegation and recovery are intentionally not enabled in this stage; an approved non-academic issuer owner can manage its roster.
5. Roster imports support large cohorts through the existing chunked import queue. Certificate issuance remains capped at 500 items per batch; cohorts above 500 must use separate batches for now. A parent campaign that orchestrates multiple batches should be considered after load testing.
6. Perform representative worker, storage and database load tests before changing the existing 500 certificate-per-batch limit.
7. Review the draft pull request, merge only after staging validation, then deploy migrations before deploying the application code.

No migrations have been applied to the connected production Supabase project and no production deployment has been made. Automated isolated PostgreSQL migration assertions and the existing application CI suite have passed on the validated branch revision; later commits must pass CI again before merge.
