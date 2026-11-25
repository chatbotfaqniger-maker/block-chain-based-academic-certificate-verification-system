# VERITY production migration-history reconciliation

**Audit date:** 24 November 2026  
**Supabase project:** `fnsnhasnjmvodkwmdqkc`

## Finding

After the 23 November 2026 production changes, the connected Supabase project reports **59 applied migration versions**, while the repository's `supabase/migrations` directory contains **24 SQL migration files**. Sixteen repository files match applied migration version prefixes; **43 applied database versions still have no matching migration file in the repository**.

This does not by itself prove that the live database schema is incorrect. It does mean that the repository does not currently contain a complete, reproducible migration history for a clean environment. Standard CLI migration operations could interpret missing historical files as unapplied and attempt to replay schema changes.

## Recent repository-tracked migrations applied to production

- `20261123221423_restrict_sensitive_rpc_execution` — restricts sensitive RPC execution and supports the verification rate-limit hardening.
- `20261123223013_add_durable_roster_import_queue` — extends the existing student roster/import history, adds a private chunk queue and installs a service-role-only worker RPC. The migration and matching application code are deployed; the worker remains disabled until its server-only key and enable flag are configured.
- `20261124071328_durable_bulk_certificate_issuance_queue` — adds the durable institution bulk certificate issuance batch/item queue, idempotency linkage, private document metadata, lease/retry/reconciliation RPCs and RLS. The migration and matching application code are deployed; the worker remains disabled.
- `20261124074628_certificate_ledger_integrity_hardening` — hardens certificate immutability, append-only ledger access, protected RPC execution and record-aware ledger verification. PR #9 is merged and the Render application deployment is live. The migration is applied and its production integrity/privilege assertions passed.

## Applied database versions missing from the repository

```text
20261114211414_create_verity_academic_credentials_schema
20261114212532_switch_verity_to_supabase_auth_and_publishable_api
20261114212545_support_verity_employer_signup_roles
20261114212711_grant_verity_admin_only_after_email_confirmation
20261114212803_tighten_verity_trigger_permissions_and_index_relations
20261114212820_restrict_public_certificate_lookup_to_anonymous_verification
20261115083914_organization_accounts_and_student_memberships
20261115084052_student_membership_rpc_and_immutability
20261115084138_restrict_membership_rpc_to_authenticated
20261115093725_add_verity_verification_keys
20261115093918_add_authenticated_verification_organization_lookup
20261115094118_add_student_controlled_certificate_sharing
20261115094205_protect_certificate_access_grant_transitions
20261115094240_scope_granted_certificate_and_verification_reads
20261117112421_harden_staff_assignments
20261121104051_remove_antivirus_scan_gates
20261121112824_public_verity_organization_identity_functions
20261121113747_add_supabase_hash_chained_certificate_ledger
20261121113845_correct_ledger_identifier_and_backfill_existing_certificates
20261121113920_fix_ledger_hash_function_search_path
20261122121434_organization_directory_visibility
20261122143103_add_verity_issue_resolution_centre
20261122143339_restrict_issue_report_update_columns
20261122143504_enforce_new_issue_report_defaults
20261122143950_add_secure_verity_support_conversations
20261122144217_snapshot_support_chat_author_display
20261122154058_verity_support_chat_file_attachments
20261122154734_verity_support_assignment_unread_and_push_subscriptions
20261122192524_student_identity_registration_foundation
20261122193345_enforce_institution_invitation_code_expiry_setting
20261122194202_student_activation_tokens_and_atomic_roster_claim
20261122194353_student_signup_precheck_and_authoritative_roster_identity
20261122194416_public_student_signup_institution_options
20261122194847_normalize_student_matriculation_whitespace
20261122194929_student_recovery_two_person_approval
20261122195012_institution_student_recovery_two_person_workflow
20261122195038_allow_first_reviewer_to_open_and_approve_recovery
20261122195101_simplify_two_person_student_recovery_approval
20261122195410_allow_recovery_officers_to_issue_replacement_activation_tokens
20261122195704_secure_ict_recovery_case_claimant_lookup
20261122195752_secure_ict_roster_claimant_identity_lookup
20261122195805_scope_student_roster_lookup_to_exact_institution
20261122195847_remove_ambiguous_student_roster_lookup_overload
20261123114847_enforce_staff_permission_boundary
```

## Release safety rules

Until the missing history is recovered or a verified baseline is established:

1. Do **not** run `supabase db push`, `db reset`, or automated migration repair against production.
2. Do not replay missing historical migrations blindly.
3. Keep new schema changes additive, individually reviewed and tested against an isolated PostgreSQL fixture.
4. When a production migration is applied through the managed migration workflow, commit the exact SQL and align its filename with the version recorded in Supabase.
5. The student roster-import, bulk certificate-issuance queue and certificate-ledger hardening migrations are verified and applied, and the matching application code is deployed. Keep both background workers disabled unless separately approved. The workers run in-process on the existing Render web service; no separate paid worker service is required.

## Bulk issuance status

The original student-import proposal (PR #3) was not safe to merge because it assumed a different roster schema and would have disrupted existing student registration/identity flows. It has been superseded by the compatible implementation in PR #7. Its additive migration `20261123223013_add_durable_roster_import_queue` is applied and CI-tested; the matching application code is deployed. The in-process worker is disabled by default until a server-only Supabase key and `ENABLE_STUDENT_IMPORT_WORKER=true` are configured.

Bulk certificate issuance is delivered by PR #8. Its additive queue migration `20261124071328_durable_bulk_certificate_issuance_queue` is applied, its matching application code is deployed, and its isolated PostgreSQL tests passed. The in-process worker remains disabled.

Certificate ledger hardening is delivered by PR #9. Its migration `20261124074628_certificate_ledger_integrity_hardening` is applied after the merged application deployment became live. Production verification confirmed one certificate and one ledger event remain present; the record-aware verification returned `ledger_valid=true` and `record_matches=true`; zero public tables retain application-role TRUNCATE privileges; and `service_role` has SELECT but not INSERT, UPDATE or DELETE on `CertificateLedger`. The migration was adjusted to change default privileges only for its own migration role after PostgreSQL rejected cross-role default-privilege changes; the exact adjusted SQL is committed in the repository. Both background workers remain disabled.

## Next reconciliation work

- Recover or reconstruct the missing historical SQL from source branches, backups and the live schema.
- Generate a schema snapshot covering tables, constraints, indexes, RLS policies, functions, triggers, grants and storage policies.
- Compare the snapshot with repository migrations and document any intentional differences.
- Validate a clean database bootstrap in CI before re-enabling automated migration deployment.


## 25 November 2026 follow-up — live ledger and historical source recovery

A fresh read-only check of the connected production project (`fnsnhasnjmvodkwmdqkc`) on 25 November reports:

- Project status: `ACTIVE_HEALTHY`
- Applied migration versions: **67**
- Latest applied version: `20261124175741`
- Public catalog inventory: 27 base tables, 64 RLS policies, 28 public-schema functions, 9 non-internal public-table triggers, 185 constraints and 103 indexes.

These are inventory counts, not proof that every live object is semantically identical to a source migration. The previous 24 November figure of 59 applied versions is now historical and must not be used as the current ledger count.

### Recovery investigation result

The repository commit search did not locate source commits for the oldest missing migration filenames. The historical PR review also confirms that `20261124133000_atomic_historical_certificate_conversion.sql` was deliberately removed in PR #15 because its prerequisite schema was incomplete. It must not be restored or replayed as a production migration merely because a later historical ledger or old documentation mentions the feature.

The investigation has therefore **not** recovered the 43 older SQL sources. No SQL has been reconstructed from current catalog definitions, and no migration ledger rows have been inserted, deleted or rewritten.

### Current PR #20 release additions

The two new PR #20 migration versions are still absent from the production ledger:

- `20261125100000_owner_approved_roster_and_credential_corrections`
- `20261125120000_persistent_roster_import_drafts`

They remain feature-branch-only. Production migration execution remains blocked pending verified baseline recovery, a full schema diff, isolated bootstrap and explicit release authorization.

### Next safe action

Obtain the original migration files from the Supabase project history/export or the original source backups/branches. If the exact SQL cannot be recovered, establish and document a verified baseline snapshot through a controlled, reviewed process; do not invent historical migration files or use migration repair to silence discrepancies. Then validate clean bootstrap in CI against that baseline.
