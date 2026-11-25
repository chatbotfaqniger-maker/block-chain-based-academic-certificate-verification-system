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
