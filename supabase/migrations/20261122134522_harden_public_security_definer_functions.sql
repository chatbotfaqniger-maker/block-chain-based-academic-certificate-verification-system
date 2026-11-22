-- Keep privileged functions on an empty search_path and prevent direct RPC
-- execution of trigger-only ledger functions. Trigger execution itself remains
-- attached to the table triggers and does not require caller EXECUTE grants.
alter function public.set_verity_organization_directory_visibility(boolean) set search_path = '';
alter function public.verify_verity_certificate_ledger(text) set search_path = '';
alter function public.verity_append_certificate_ledger() set search_path = '';
alter function public.verity_prevent_ledger_mutation() set search_path = '';
alter function public.verity_public_certificate_issuer(text) set search_path = '';

revoke all on function public.verity_append_certificate_ledger() from public, anon, authenticated;
revoke all on function public.verity_prevent_ledger_mutation() from public, anon, authenticated;
