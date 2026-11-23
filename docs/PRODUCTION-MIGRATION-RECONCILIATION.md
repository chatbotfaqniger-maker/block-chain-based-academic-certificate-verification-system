# VERITY production migration-history reconciliation

**Audit date:** 23 November 2026  
**Supabase project:** `fnsnhasnjmvodkwmdqkc`

## Finding

At the time of this audit, the connected Supabase project reported **55 applied migration versions**, while the repository's `supabase/migrations` directory contained **22 SQL migration files**. Only 12 repository files matched applied migration version prefixes; **43 applied database versions had no matching migration file in the repository**.

This does not by itself prove that the live database schema is incorrect. It does mean that the repository does not currently contain a complete, reproducible migration history for a clean environment. Standard CLI migration operations could interpret missing historical files as unapplied and attempt to replay schema changes.

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
5. Before enabling the bulk student-import or bulk certificate-issuance queues, verify their migrations against the actual production schema and reconcile the migration history.

## Bulk issuance status

The institution student-import work (PR #3) and bulk certificate issuance work (PR #4) are not deployed. Their queue migrations are not present in the live migration history. PR #4 currently provides a browser-sequential issuance experience and database queue groundwork only; it does not yet provide the complete durable server-side issuance worker and retry/reconciliation workflow.

## Next reconciliation work

- Recover or reconstruct the missing historical SQL from source branches, backups and the live schema.
- Generate a schema snapshot covering tables, constraints, indexes, RLS policies, functions, triggers, grants and storage policies.
- Compare the snapshot with repository migrations and document any intentional differences.
- Validate a clean database bootstrap in CI before re-enabling automated migration deployment.
