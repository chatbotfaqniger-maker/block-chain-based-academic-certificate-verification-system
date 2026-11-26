# VERITY production migration and schema audit — 25 November 2026

**Audit time:** 25 November 2026, approximately 09:50 WAT  
**Supabase project:** `fnsnhasnjmvodkwmdqkc`  
**Application branch reviewed:** `feat/immutable-credentials-and-owner-approved-roster`  
**Pull request:** [#20](https://github.com/chatbotfaqniger-maker/block-chain-based-academic-certificate-verification-system/pull/20)

## Scope and safety

This was a read-only inspection of the connected production project's migration ledger and PostgreSQL catalog metadata. No SQL DDL/DML, migration repair, migration application, reset, deployment, or merge was performed.

## Current production observations

The Supabase project reports `ACTIVE_HEALTHY`. Its migration ledger contains **67 applied versions**, with latest version **`20261124175741`**.

The live public-schema catalog inventory reports:

| Catalog item | Count |
| --- | ---: |
| Base tables | 27 |
| RLS policies | 64 |
| Public-schema functions | 28 |
| Non-internal public-table triggers | 9 |
| Constraints | 185 |
| Indexes | 103 |

These are catalog counts, not a semantic proof that every object matches the intended application behavior. They do not replace a complete schema export and comparison.

The previous reconciliation record dated 24 November reported 59 applied versions. The live ledger now reports 67, so the old count and its derived unmatched-version count must not be reused as current figures.

## PR #20 migrations not present in the production ledger

The current PR #20 diff includes these two additive migration files:

- `20261125100000_owner_approved_roster_and_credential_corrections.sql`
- `20261125120000_persistent_roster_import_drafts.sql`

Neither version appears in the production migration ledger. They remain feature-branch-only and must not be applied until the full migration-history and schema reconciliation is complete and release approval is explicitly given.

## Migration-history findings

The applied ledger contains historical versions whose original SQL is not represented in the repository's current migration directory, as already recorded in [the reconciliation procedure](PRODUCTION-MIGRATION-RECONCILIATION.md). It also contains multiple later version entries whose names reference earlier migration versions (for example, the 22 November staff-document migration and the 23/24 November roster/bulk-issuance/ledger migrations). These records must be treated as applied history, not as instructions to replay their contents.

Do not infer that a migration is safe to replay from its name, timestamp, or apparent equivalence to a repository file. Do not delete or rewrite migration-ledger rows to make the counts appear aligned.

## Required next reconciliation work

1. Export a complete, access-controlled schema snapshot from production, covering tables, column definitions, enums, constraints, indexes, RLS enablement and policies, functions and definitions, triggers, grants/default privileges, and Storage buckets/policies.
2. Inventory every repository migration file on the relevant release branches and map each filename/version to the production ledger. Identify exact source commits or backups for missing historical SQL; do not reconstruct SQL by guessing from current object definitions.
3. Compare the schema snapshot against the migrations and application assumptions. Record intentional drift and unresolved differences in a reviewable manifest.
4. Build a clean disposable PostgreSQL database from the recovered baseline plus ordered migrations, then run the existing CI database fixtures and application tests against that clean bootstrap.
5. Only after the above passes, prepare a separately reviewed, additive release migration plan. Production changes require explicit release authorization and must be applied one migration at a time with post-migration verification.

## Release status

- PR #20 remains separate from production.
- The two PR #20 migrations listed above have not been applied to production.
- No production schema changes were made during this audit.
- No application deployment or PR merge was performed.
- Keep the student roster import worker disabled until its matching production migration and application deployment are both verified and the required server-only configuration is confirmed in Render.


## 25 November 2026 follow-up — exact migration-source comparison

A follow-up read-only comparison enumerated all 67 entries returned by the Supabase CLI migration list and all 34 SQL migration files on the reviewed feature branch. Results: 15 exact version-prefix matches; 16 ledger entries with a normalized name match but version-prefix drift/alias; 36 applied ledger entries with no normalized source-name match; and 6 repository SQL files with no matching applied ledger name. The earlier 43 figure in the 24 November reconciliation was based on an older 59-entry ledger snapshot and is not the current count.

A name match does not prove that the file bytes equal the SQL executed in production. The live ledger contains duplicate/aliased names for staff-document metadata, roster import, bulk issuance and certificate-ledger hardening. The exact per-entry comparison and Git blob SHAs are captured in [production-migration-ledger-2026-11-25.json](production-migration-ledger-2026-11-25.json). This manifest is an inventory only; it is not a verified schema baseline and must not be used to replay migrations.

The separate internal `storage.migrations` table reported 81 rows; it is not the Supabase CLI migration ledger and must not be conflated with the 67 applied project migration entries. No production SQL, migration repair, reset, merge or deployment was performed.


## 25 November 2026 follow-up — read-only catalog snapshot

Captured [production-schema-catalog-2026-11-25.json](production-schema-catalog-2026-11-25.json) from read-only PostgreSQL catalog queries. The snapshot contains metadata only (no application row data or function source bodies): 27 public base tables, 185 constraints, 103 indexes, 64 public RLS policies, 28 public functions/procedures, 9 non-internal public triggers, 2 public enums, 5 extensions, 452 table-grant rows, 69 routine-grant rows, 3 Storage buckets, 7 Storage policies, zero public views/materialized views and one public sequence.

This is not a complete `pg_dump` or a clean-bootstrap artifact. It excludes Auth internals, managed Storage internals, function source bodies and data. It can support a later schema comparison, but cannot reconstruct the historical migration chain. A clean bootstrap remains blocked pending original SQL recovery or a separately reviewed complete baseline export. No development branch was created and no production schema or data was changed.


## 25 November 2026 follow-up — historical branch source recovery

The source search was expanded to six branches containing distinct migration-file variants. The branch union contains 39 unique SQL files; the exact filename, Git blob SHA, branch provenance and comparison to all 67 applied ledger entries are in [production-migration-source-recovery-2026-11-25.json](production-migration-source-recovery-2026-11-25.json). Counts remain 15 exact version matches, 16 normalized-name matches with version drift and 36 applied entries without a source filename match; eight source files have no ledger name match.

Historical PR review found PR #7 added roster-import queue SQL, PR #9 added a prior ledger-hardening SQL, PR #11 added certificate design/digitization SQL, PR #13 added atomic historical conversion, and PR #15 removed the historical-conversion SQL and test assertions because prerequisites were incomplete. The removal is intentional and must not be undone without completing and validating the prerequisites. Some branches contain differing source variants for similarly named queue/ledger migrations; blob SHAs are recorded and must be compared before selecting a source.

This improves provenance but does not recover the missing historical SQL or prove that any source file matches production-executed bytes. The clean-bootstrap gate remains closed. No production SQL, migration repair, merge or deployment was performed.


### Pull-request provenance cross-check

Historical PR file lists #1–#19 were reviewed. Migration changes appeared in PRs #3–#9, #11, #13–#15 and #17–#19. PRs #1, #2, #10, #12 and #16 had no migration-file changes. PR #15 removed the historical conversion migration previously introduced in PRs #13/#14 because its prerequisite schema/workflow was incomplete. The detailed PR/file/blob inventory is maintained in [production-migration-source-recovery-2026-11-25.json](production-migration-source-recovery-2026-11-25.json).
