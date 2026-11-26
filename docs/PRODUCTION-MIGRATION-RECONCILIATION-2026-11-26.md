# VERITY migration reconciliation delta — 26 November 2026

**Scope:** Read-only production ledger inspection and feature-branch source review.  
**Supabase project:** `fnsnhasnjmvodkwmdqkc`  
**Feature branch:** `feat/immutable-credentials-and-owner-approved-roster`

## Current production ledger

The connected production project reports **68 applied Supabase CLI migration versions**. The latest is:

- Version: `20261126112216`
- Name: `quarantine_certificate_storage_until_clean_scan`

The feature branch currently contains **35 SQL migration files**. This count is not a complete historical source recovery and must not be compared as though every source file corresponds one-to-one with a production ledger entry.

## New migration identity mismatch

The latest `main` branch contains:

- Source filename: `20261126112500_quarantine_certificate_storage_until_clean_scan.sql`
- Production ledger entry: `20261126112216_quarantine_certificate_storage_until_clean_scan`

The normalized migration name matches, but the 14-digit version does not. The production Storage policy currently contains the `scanStatus = 'CLEAN'` condition described by that migration. The live catalog therefore confirms the quarantine policy is active, but the migration ledger does not store a source checksum proving byte-for-byte identity.

**Do not run `supabase db push` or rename/copy this source file to a different timestamp based only on the name match.** That could make the CLI treat an already-applied change as pending and replay it.

## PR #20 migration status

The following feature-branch migrations are not present in the production ledger:

- `20261125100000_owner_approved_roster_and_credential_corrections`
- `20261125120000_persistent_roster_import_drafts`
- `20261126130000_restore_authorized_document_access_before_scanner`

They remain un-applied. The last migration is intended to restore authorized access while malware scanning is deferred; it does not label unscanned documents as clean.

## Storage-policy review

A read-only query of production `storage.objects` policies found:

- `verity_private_certificate_read` currently requires a `CLEAN` scan status.
- `verity_storage_granted_verifier_read` is a separate policy and remains tied to an approved, unexpired certificate-access grant and approved `VERIFY_CREDENTIALS` capability.
- Organization-evidence reads remain limited to the owning organization and VERITY administrators; no scan-status predicate was present in that read policy.

The launch migration changes only `verity_private_certificate_read`. It does not drop or replace the separate graduate-consent verifier policy.

## Changes made on the feature branch

- Removed an institution-only type restriction from the private certificate read policy. Approved EMPLOYER issuers must also be able to read their own documents.
- Added a PostgreSQL 16 CI fixture and regression assertions for private bucket isolation, issuer ownership, graduate access, active staff download permission, administrator access, approved/unexpired verifier grants, and expired-grant denial.
- Added a dedicated `document-access-policy-postgres` GitHub Actions job.
- Kept malware scanning deferred. No fake `CLEAN` status or scanner result is created.

The new document-access CI job has completed all of its test steps successfully in workflow run **#693**. The remaining workflow jobs were still running at the time of this addendum.

## Remaining release blockers

1. Re-run the full exact ledger-to-source comparison across all source-bearing branches using the current 68-entry production ledger.
2. Resolve the version mismatch for the quarantine migration without replaying it or fabricating historical SQL.
3. Reconcile the two commits on `main` with PR #20. One adds API-level 423 quarantine guards; those guards conflict with the approved scanner-deferred launch policy and must not be carried into the launch implementation.
4. Complete the full CI run and review every job result.
5. Continue using local PostgreSQL CI for isolated tests. No paid Supabase branch is required.

No production DDL/DML, migration repair, merge, or deployment was performed.
