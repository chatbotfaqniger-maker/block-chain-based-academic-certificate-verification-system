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

## Current implementation status

This document records the audited baseline and safe implementation sequence. It does not claim that issuer expansion, capability approvals, school-level onboarding, or increased bulk limits have been implemented or deployed.
