# VERITY migration reconciliation — 26 November 2026

**Scope:** Read-only production migration ledger and schema inspection, feature-branch source comparison, and PostgreSQL CI verification.  
**Supabase project:** `fnsnhasnjmvodkwmdqkc`  
**Feature branch:** `feat/immutable-credentials-and-owner-approved-roster`

## Verified CI result

GitHub Actions workflow **#695** completed successfully: **10 jobs passed, 0 failed**. This includes the main build/test and Docker image build, bulk issuance, certificate ledger security, roster import, organization capability, certificate design, RPC privileges, owner-approved record integrity, issuer workflow, and the new document-access policy regression job.

This validates the tested branch fixtures and build. It does not prove production migration history is reconciled or authorize a production migration.

## Production migration ledger and source comparison

The connected production project reports **68 applied migration ledger entries**. The feature branch contains **35 SQL migration files**; `main` contains 33.

A raw version comparison is misleading. After normalizing migration names:

- **28 of 35** feature-branch migration files have a matching logical name in the production ledger.
- **17 of those 28** have a different 14-digit source filename version from the production ledger version.
- **7 files** have no normalized-name match in the production ledger. These require individual schema/effect review, not automatic replay.

This is evidence of historical timestamp/source drift. A matching name is not proof that the SQL bytes are identical; a different timestamp is not proof that the migration's effect is absent.

### Seven unmatched feature-branch files — disposition

| Feature migration | Read-only production evidence | Disposition |
|---|---|---|
| `20261122195500_allow_ict_recovery_token_reissue.sql` | The current activation-token RLS policy already permits the approved recovery permission, but also enforces the approved `ISSUE_CREDENTIALS` capability. The feature file's replacement policy omits that capability check. | **Do not replay.** It could weaken current production authorization. |
| `20261122202000_secure_ict_roster_claimant_lookup.sql` | The production `list_verity_student_roster(text,text)` function already exists, scopes results to the requested organization, enforces `ISSUE_CREDENTIALS`, and returns claimant details. | **Do not replay without a deliberate reviewed diff.** The feature file imposes an institution-only type restriction that may exclude other approved credential issuers. |
| `20261122202500_drop_ambiguous_student_roster_lookup.sql` | Production exposes the two-argument roster function; the ambiguous one-argument overload is absent. | **Effect already present.** Do not replay. |
| `20261124110000_institution_certificate_design_and_digitization.sql` | Read-only schema inspection found neither `InstitutionCertificateTemplate` nor `CertificateDigitizationCase`. | **Not applied.** Needs controlled migration planning and test review. |
| `20261125100000_owner_approved_roster_and_credential_corrections.sql` | Production lacks the correction-request tables and owner-approval columns inspected in this audit. | **Not applied.** This is a genuine release migration candidate. |
| `20261125120000_persistent_roster_import_drafts.sql` | Production lacks `StudentRosterImportDraft` and `StudentRosterImportDraftChunk`. | **Not applied.** This is a genuine release migration candidate. |
| `20261126130000_restore_authorized_document_access_before_scanner.sql` | Production private certificate read policy still requires `scanStatus = 'CLEAN'`. | **Not applied.** This is the scanner-deferred launch access migration candidate. |

## Quarantine migration version mismatch

The source on `main` is:

- `20261126112500_quarantine_certificate_storage_until_clean_scan.sql`

The production ledger records:

- Version `20261126112216`
- Name `quarantine_certificate_storage_until_clean_scan`

The normalized name matches, but the versions differ. The live private Storage policy currently includes the `CLEAN` gate. The ledger does not provide a source checksum proving byte-for-byte identity.

**Do not run `supabase db push`, rename the source file, or use migration repair based only on the name match.** The exact historical source and applied SQL must be recovered or independently verified first.

## Storage-policy review and scanner decision

Read-only production inspection confirmed:

- `verity_private_certificate_read` currently requires a `CLEAN` scan status.
- `verity_storage_granted_verifier_read` is a separate policy tied to an approved, unexpired certificate-access grant and approved `VERIFY_CREDENTIALS` capability.
- `verity_org_evidence_storage_read` remains a separate policy.
- The launch migration changes only `verity_private_certificate_read`; it does not drop or replace the graduate-consent verifier policy.
- The launch policy allows an approved EMPLOYER issuer owner to access its own documents, as well as authorized institution owners, linked graduates, active staff with `documents:download`, and VERITY administrators.

Malware scanning remains a planned future feature, not a launch prerequisite. The application must not label unscanned documents as clean. Private storage, role checks, file validation and SHA-256 integrity checks remain required.

## Feature-branch changes and test results

- Updated the scanner-deferred private document read migration.
- Added PostgreSQL 16 fixtures and assertions for anonymous denial, issuer ownership and tenant isolation, graduate access, active staff download permission, admin access, approved/unexpired verifier grants, and expired-grant denial.
- Added the `document-access-policy-postgres` CI job.
- Preserved owner approval for roster imports and correction workflows; issued credentials remain immutable.

**Workflow #695:** 10/10 jobs passed.  
**Production:** no DDL/DML or migration history repair performed.

## Release blockers and safe next steps

1. Recover and verify the exact SQL source corresponding to all production ledger versions whose repository timestamps differ.
2. Resolve the quarantine migration's timestamp mismatch without replaying or fabricating historical SQL.
3. Decide whether the certificate design/digitization migration is part of this release; it is not currently present in the production schema.
4. Prepare a controlled migration plan for the three genuine PR candidates: owner-approved roster/corrections, persistent drafts, and scanner-deferred document access. Test against a production-shaped local PostgreSQL fixture before any production action.
5. Keep the three already-present or potentially weakening migrations out of any blind replay.
6. Reconcile the two commits on `main` with PR #20. In particular, do not reintroduce API-level HTTP 423 scanner gates while scanning is deferred.
7. Complete final review and request explicit approval before any production migration, merge to `main`, or deployment.

No paid Supabase branch is required. No production DDL/DML, migration repair, merge, or deployment was performed.
