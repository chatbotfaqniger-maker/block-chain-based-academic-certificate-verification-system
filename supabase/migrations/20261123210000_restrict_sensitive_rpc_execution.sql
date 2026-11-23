-- VERITY RPC execution boundary hardening.
-- Public RPCs are explicitly allow-listed; identity, roster and recovery operations
-- are authenticated-only. Trigger functions are not directly callable by API roles.

-- Secure future functions created by either migration owner by default. Any future
-- RPC that must be callable through PostgREST must receive an explicit GRANT.
-- PostgreSQL's built-in PUBLIC function EXECUTE default is global, so revoke it
-- globally as well; a per-schema REVOKE cannot override a global default grant.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- Authenticated-only identity, roster, recovery and organization operations.
REVOKE ALL ON FUNCTION public.activate_verity_student_roster(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_verity_student_roster(text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.complete_verity_student_recovery(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_verity_student_recovery(text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.list_verity_student_recovery_cases(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_verity_student_recovery_cases(text) TO authenticated;

REVOKE ALL ON FUNCTION public.list_verity_student_roster(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_verity_student_roster(text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.lookup_verity_certificate_for_org(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_verity_certificate_for_org(text) TO authenticated;

REVOKE ALL ON FUNCTION public.request_verity_membership(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_verity_membership(text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.review_verity_student_recovery(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_verity_student_recovery(text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.set_verity_organization_directory_visibility(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_verity_organization_directory_visibility(boolean) TO authenticated;

-- Explicitly public, narrowly scoped operations used by QR verification,
-- organization directory display and the graduate registration precheck.
REVOKE ALL ON FUNCTION public.lookup_verity_certificate(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_verity_certificate(text, text, text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.verify_verity_certificate_ledger(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_verity_certificate_ledger(text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.verity_public_certificate_issuer(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verity_public_certificate_issuer(text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.verity_public_organization_directory(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verity_public_organization_directory(text, text, text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.verity_student_registration_precheck(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verity_student_registration_precheck(text, text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.verity_student_signup_institutions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verity_student_signup_institutions() TO anon, authenticated;

-- Trigger-only functions must never be callable as API RPCs. PostgreSQL invokes
-- them through their table triggers without granting EXECUTE to client roles.
REVOKE ALL ON FUNCTION public.handle_new_verity_user() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.verity_append_certificate_ledger() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.verity_prevent_ledger_mutation() FROM PUBLIC, anon, authenticated, service_role;
