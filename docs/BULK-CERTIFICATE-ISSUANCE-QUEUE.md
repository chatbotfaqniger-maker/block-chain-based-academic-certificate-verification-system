# VERITY durable bulk certificate issuance — implementation notes

## Current status

This branch contains the first database-schema increment for a durable issuance queue. It is not yet wired into the application and must not be enabled in production.

The migration creates:

- `CertificateIssuanceBatch`: tenant-scoped batch status and counters.
- `CertificateIssuanceItem`: one row per student, normalized student number, immutable idempotency key, payload, optional private-storage object reference, processing lease, and resulting certificate ID.
- A unique idempotency constraint per institution and row key.
- A row-locking claim RPC using `FOR UPDATE SKIP LOCKED`.
- A lease-token-checked finalize RPC.
- Authenticated read-only policies and service-role-only queue mutation privileges.

## Required next implementation steps

1. Add authenticated server endpoints to create a batch and stage each item after the institution explicitly confirms the preview.
2. Upload source PDFs to a private staging location before queueing; persist only object keys and SHA-256 digests, never document bytes in JSONB.
3. Add a dedicated worker that claims items, validates the current institution approval, calls the same certificate issuance and document-validation logic as individual issuance, and finalizes each item with its lease token.
4. Make issuance idempotent across retries. Before creating a certificate, reconcile the item idempotency key and existing certificate registry. A timeout after certificate insertion must move the item to review, never blindly create another certificate.
5. Add authenticated batch/item status endpoints and update the institution UI to poll status, resume viewing, and download results.
6. Test the migration and worker against an isolated local PostgreSQL/Supabase stack before applying it to any hosted database.

## Safety boundaries

- The migration is additive and is not applied to the hosted Supabase project.
- The worker is not enabled by default.
- PR #3 and PR #4 remain unmerged; no Render deployment is triggered by this work.
- Existing single issuance remains the authoritative issuance path until the shared issuance service is extracted and covered by tests.
- A generated PDF remains a draft template requiring institutional authorization/signature.
- Antivirus scanning is not implemented.
- Expired leases that may have created a certificate require reconciliation; they must not be retried as a new issuance automatically.

## Local validation

The repository's normal CI validates JavaScript syntax, frontend build, automated tests, and Docker image construction. Those checks do not execute this SQL migration. A PostgreSQL migration test is a required gate before the queue can be considered operational.
