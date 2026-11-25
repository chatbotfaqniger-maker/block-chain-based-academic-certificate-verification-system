# VERITY clean-bootstrap recovery runbook

**Status:** blocked — historical source SQL is incomplete  
**Last reviewed:** 25 November 2026  
**Production project:** `fnsnhasnjmvodkwmdqkc`  
**Scope:** recovery and validation only; this document does not authorize production changes.

## Current evidence

- Supabase CLI migration ledger: 67 applied entries; latest version `20261124175741`.
- All 20 GitHub branches were enumerated and their `supabase/migrations` directories inspected.
- Six branches cover the distinct source-bearing migration variants. Their union contains 39 unique SQL filenames.
- The branch-wide comparison yields 15 exact version-prefix matches, 16 normalized-name matches with version drift, and 36 applied ledger entries without a matching source filename.
- All repeated filenames across the six source-bearing branches have identical Git blob SHAs. However, several *different filenames* share normalized migration names and have different blob SHAs; these are distinct source variants, not interchangeable files.
- Historical PRs #1–#19 were reviewed for migration-file changes. PR #15 intentionally removed the historical certificate-conversion RPC and its CI assertions because prerequisites were incomplete.
- Read-only schema catalog metadata exists in `production-schema-catalog-2026-11-25.json`. It is not a complete database export or restore artifact.

See:
- [Migration ledger inventory](production-migration-ledger-2026-11-25.json)
- [Schema catalog snapshot](production-schema-catalog-2026-11-25.json)
- [Historical source recovery inventory](production-migration-source-recovery-2026-11-25.json)
- [Production migration audit](PRODUCTION-MIGRATION-AUDIT-2026-11-25.md)

## Recovery procedure

### 1. Preserve source and evidence

- Keep production `main`, the live Supabase project and the current deployment unchanged.
- Preserve the existing migration inventory, source-recovery manifest and catalog snapshot.
- Do not rename migration files to fit production versions.
- Do not select one of the alternate roster/bulk-issuance/ledger files by filename similarity alone.
- Do not restore the historical-conversion migration removed by PR #15 without its full prerequisite workflow and a dedicated regression suite.

### 2. Recover original historical SQL

Request the exact SQL source files for the 36 unmatched applied ledger entries from the original development environment, including:
- original developer workstations and local `supabase/migrations` folders;
- archived Git branches, commits, patches and repository backups;
- reviewed SQL Editor scripts or deployment artifacts;
- database backup/export archives retained by the project owner.

For each recovered file, record its original filename, source location, retrieval date, byte length and SHA-256 digest. Keep the recovered artifact immutable. A migration name or current catalog object is not a substitute for the original SQL bytes.

### 3. Reconcile source to live ledger

For every applied ledger entry:
- identify the exact source file or document that it has not been recovered;
- compare the 14-digit version and complete migration name;
- compare source digests against any trusted deployment artifact;
- document timestamp drift, aliases, duplicate names and ordering dependencies;
- require a human-reviewed explanation for every unresolved mapping.

Do not infer that an SQL file was executed merely because its normalized name resembles a ledger entry.

### 4. Establish a verified baseline if source recovery is impossible

If exact historical SQL cannot be recovered, stop trying to recreate the migration chain. Instead, obtain a complete, owner-approved database export from the live project through a supported backup/export process. The export must account for all required application schemas, table data where required, constraints, indexes, RLS policies, functions and their source, triggers, grants, extensions, sequences, Storage buckets/policies, Auth dependencies and relevant configuration.

The catalog JSON in this repository is only an inventory aid. It is not sufficient to bootstrap a clean database.

A proposed baseline package must be reviewed against the live project and tested on a separate disposable PostgreSQL/Supabase environment. No new paid Supabase branch or project is to be created without first presenting the exact cost and receiving approval.

### 5. Validate a clean bootstrap

A clean bootstrap is accepted only when:
- an empty test database can be built from the reviewed baseline package without relying on production state;
- the resulting catalog matches the approved baseline for objects, definitions, RLS, grants and extensions;
- the application's existing CI database fixtures and all migration regression suites pass;
- application integration tests pass against the newly bootstrapped environment;
- a second independent bootstrap produces the same schema fingerprint;
- the release reviewer signs off on the evidence and unresolved differences are zero or explicitly accepted.

### 6. Production release gate

Only after the above validation and a separate explicit release approval may a production migration plan be prepared. Production migration history must not be rewritten to make filenames or counts appear consistent. No `db push`, reset, repair, migration replay, merge or deployment is authorized by this runbook.

## Current decision

**Clean bootstrap: NOT READY.** The 39-file source inventory improves provenance, but 36 applied ledger entries still lack a matching source filename. The next required input is original SQL or a complete approved export. Production remains untouched.
