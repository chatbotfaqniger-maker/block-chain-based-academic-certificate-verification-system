# VERITY — Institutional Record Approval & Immutable Credential Policy

**Status:** Proposed implementation on `feat/immutable-credentials-and-owner-approved-roster`  
**Scope:** Student Directory, roster import, credential correction, audit and user guidance.

## 1. Non-negotiable credential rule

An issued certificate is an immutable historical credential. No user, including the Institution Owner, ICT officer, organization owner or VERITY System Administrator, may edit its academic contents, certificate ID, verification key, issuer identity, graduate association or original SHA-256 fingerprint.

The production database already contains the `verity_guard_certificate_record()` trigger from the certificate-ledger hardening migration. It rejects certificate deletion and changes to issued academic fields/fingerprint. Its only permitted post-issuance changes are the explicitly controlled ACTIVE-to-REVOKED transition and one-time optional blockchain anchor metadata. Revocation is a status event, not an edit to the certificate.

A Student Directory correction must never cascade into an issued certificate. Certificate issuance uses its own immutable snapshot and digest.

## 2. CSV / Excel import approval

1. Authorized Institution ICT or the Institution/Organization Owner uploads a supported `.csv` or native `.xlsx` roster file. XLSX workbooks must contain exactly one visible, non-empty worksheet; legacy `.xls` and macro-enabled `.xlsm` files are not accepted.
2. VERITY validates headers, required values, dates, duplicate student numbers and file limits.
3. VERITY validates the workbook headers and values, rejects formula cells and numeric student-number cells that could lose leading zeroes, then stages rows in durable, idempotent chunks. The batch remains `UPLOADING` while chunks are staged.
4. The uploader submits the completed batch. The batch transitions to `AWAITING_APPROVAL`.
5. At this point no roster rows are inserted and no student accounts are linked.
6. The Institution or Organization Owner reviews the manifest, row totals, validation errors and batch history.
7. Only the approved credential-issuer owner can approve the batch. Institution ICT can submit but cannot approve its own upload; non-institution organizations use their owner account.
8. Approval transitions the batch to `QUEUED`; only then may the existing worker process it. Committed roster entries become eligible for VERITY's existing student account-claim and verification workflow; a matching name or student number alone never attaches an account automatically.
9. Existing institution/student-number matches are skipped as duplicates. Existing rows are never overwritten by an import.
10. Every stage, submission, approval and processing outcome is auditable.

## 3. Student Directory corrections

- ICT may submit a proposed correction with a reason.
- The live Student Directory row remains unchanged while the request is pending.
- Only the Institution Owner may approve or reject.
- Approval applies the proposal only if the original row still matches the snapshot reviewed by the requester. If the source row changed meanwhile, the request becomes `CONFLICT` and must be resubmitted against the current record.
- Claimed student numbers cannot be changed through this profile-correction workflow. Identity changes use the existing dispute/recovery process.
- The decision and actor are written to the audit history.

## 4. Issued credential correction

A credential correction request is separate from a Student Directory correction request.

1. ICT or the Institution Owner opens a request against a specific issued certificate.
2. The request stores the original certificate ID and digest plus proposed corrected values and a reason.
3. The Institution or Organization Owner approves or rejects the request.
4. Approval authorizes a separate replacement issuance; it does not update the original certificate.
5. The replacement must be issued through the existing issuance process and receives a new certificate row, certificate ID, verification key, issuance timestamp and digest.
6. The original remains unchanged. Before linking the replacement, the institution must separately revoke the original with a meaningful reason. It remains visible as a revoked historical credential.
7. The relationship between the correction request, original credential and replacement credential must be retained in the audit trail.

A correction approval alone does not issue a replacement or revoke the original. The owner must issue the replacement through the normal issuance flow, revoke the original with a reason, and then link the two records.

## 5. Security boundaries

- Authenticated clients cannot directly insert, update or delete Student Directory rows. Imports are committed by the existing privileged queue processor; approved corrections use a narrowly scoped owner-only database function.
- Import state transitions are guarded by RLS: uploader/authorized ICT can submit for approval; only the institution owner can approve and queue.
- Correction decision functions verify the authenticated owner against the owning Organization row.
- Request tables are tenant-scoped by RLS. Decisions are not client-editable.
- Service-role keys remain server-only.
- No existing certificates, roster records or student memberships are rewritten by this additive migration.

## 6. Deployment and verification gates

This feature branch is not production-active until all of the following are complete:

- Reconcile the Supabase migration history against the actual production schema.
- Apply the additive migration in an isolated Supabase test project first.
- Test owner vs ICT authorization with separate real accounts.
- Test CSV import lifecycle: upload → stage → submit → owner approval → worker commit.
- Confirm an unapproved batch is never consumed by the worker.
- Confirm duplicate roster numbers are skipped, not overwritten.
- Test correction request approval, rejection and stale-snapshot conflict.
- Attempt direct authenticated StudentRoster UPDATE/DELETE and confirm database denial.
- Attempt direct Certificate academic-field UPDATE/DELETE and confirm database denial for all application roles.
- Test certificate correction approval and verify the original certificate ID, fields, PDF fingerprint and digest remain unchanged.
- Run `npm ci`, `npm test`, `npm run build`, Docker build and the Supabase SQL regression suite.
- Only after review and approval should the migration be applied to production and the release deployed.

## 7. User Guide video — 15-clip storyboard

Each clip must be at least **5 seconds**. Target 6–9 seconds per clip. Use actual VERITY screens, the navy/teal visual identity, readable captions and no fabricated approval states.

| Clip | Minimum duration | Screen / action | Narration / on-screen lesson |
|---|---:|---|---|
| 01 | 6 sec | Open Institution workspace and Student Directory | “VERITY keeps institutional student records separate from issued certificates.” |
| 02 | 7 sec | Download the CSV or XLSX template | “Start with the official template and use accurate institutional records.” |
| 03 | 8 sec | Select CSV or native XLSX and show the one-sheet validation preview | “VERITY checks CSV/XLSX fields, formats and duplicate student numbers before staging.” |
| 04 | 7 sec | Show staged import batch and row summary | “Uploading only stages the batch. It does not commit or link students.” |
| 05 | 7 sec | Sign in as ICT and submit batch for approval | “ICT submits the completed batch to the Institution Owner; organization owners submit through their own account.” |
| 06 | 8 sec | Switch to Institution Owner and open awaiting-approval batch | “The approved issuer owner reviews the batch, validation results and row totals.” |
| 07 | 6 sec | Owner selects Approve import | “Only the issuer owner can approve. ICT cannot approve its own upload.” |
| 08 | 7 sec | Show approved batch moving into processing and results | “After approval, VERITY processes the batch and skips existing student-number matches.” |
| 09 | 7 sec | Search for a student in Student Directory | “Find a student and compare the directory details with official evidence.” |
| 10 | 8 sec | ICT opens Request correction and enters reason/proposed values | “ICT proposes a correction. The live student record remains unchanged while pending.” |
| 11 | 8 sec | Owner compares original and proposed values, then approves/rejects | “The Institution Owner makes the decision. Every action is recorded.” |
| 12 | 7 sec | Open an issued certificate and show locked details / verification | “An issued certificate is permanently locked. Directory edits never rewrite it.” |
| 13 | 8 sec | Create a separate credential-correction request | “If a certificate is wrong, submit a separate request linked to the original credential.” |
| 14 | 8 sec | Owner approves and show a new issuance screen | “Approval authorizes a new certificate. It never edits the original.” |
| 15 | 8 sec | Verify original and replacement; show original revoked/superseded history if applicable | “The original remains part of the audit history. The new credential has its own ID and fingerprint.” |

**Video production rules:** Every clip must show a real workflow state. Do not show a successful import before owner approval, do not show an Edit control on an issued certificate, and do not imply that approving a correction silently changes or automatically replaces the original credential. Keep the clips separate and individually navigable in the User Guide module.
