DO $$
BEGIN
  IF has_function_privilege('anon','public.activate_verity_student_roster(text,text,text)','EXECUTE') THEN RAISE EXCEPTION 'anon can execute student activation'; END IF;
  IF NOT has_function_privilege('authenticated','public.activate_verity_student_roster(text,text,text)','EXECUTE') THEN RAISE EXCEPTION 'authenticated cannot execute student activation'; END IF;
  IF has_function_privilege('anon','public.complete_verity_student_recovery(text,text)','EXECUTE') THEN RAISE EXCEPTION 'anon can execute recovery completion'; END IF;
  IF has_function_privilege('anon','public.list_verity_student_recovery_cases(text)','EXECUTE') THEN RAISE EXCEPTION 'anon can list recovery cases'; END IF;
  IF has_function_privilege('anon','public.list_verity_student_roster(text,text)','EXECUTE') THEN RAISE EXCEPTION 'anon can list student roster'; END IF;
  IF has_function_privilege('anon','public.review_verity_student_recovery(text,text,text)','EXECUTE') THEN RAISE EXCEPTION 'anon can review recovery'; END IF;
  IF has_function_privilege('anon','public.lookup_verity_certificate_for_org(text)','EXECUTE') THEN RAISE EXCEPTION 'anon can use organization lookup'; END IF;
  IF has_function_privilege('anon','public.request_verity_membership(text,text)','EXECUTE') THEN RAISE EXCEPTION 'anon can request membership'; END IF;
  IF has_function_privilege('anon','public.set_verity_organization_directory_visibility(boolean)','EXECUTE') THEN RAISE EXCEPTION 'anon can change directory visibility'; END IF;
  IF NOT has_function_privilege('anon','public.lookup_verity_certificate(text,text,text)','EXECUTE') THEN RAISE EXCEPTION 'public certificate verification was disabled'; END IF;
  IF NOT has_function_privilege('authenticated','public.lookup_verity_certificate(text,text,text)','EXECUTE') THEN RAISE EXCEPTION 'authenticated certificate verification was disabled'; END IF;
  IF NOT has_function_privilege('anon','public.verify_verity_certificate_ledger(text)','EXECUTE') THEN RAISE EXCEPTION 'public ledger verification was disabled'; END IF;
  IF NOT has_function_privilege('anon','public.verity_public_organization_directory(text,text,text)','EXECUTE') THEN RAISE EXCEPTION 'public organization directory was disabled'; END IF;
  IF NOT has_function_privilege('anon','public.verity_student_registration_precheck(text,text)','EXECUTE') THEN RAISE EXCEPTION 'student signup precheck was disabled'; END IF;
  IF NOT has_function_privilege('anon','public.verity_student_signup_institutions()','EXECUTE') THEN RAISE EXCEPTION 'student signup institution list was disabled'; END IF;
  IF has_function_privilege('anon','public.verity_append_certificate_ledger()','EXECUTE') THEN RAISE EXCEPTION 'anon can execute ledger trigger function'; END IF;
  IF has_function_privilege('authenticated','public.verity_prevent_ledger_mutation()','EXECUTE') THEN RAISE EXCEPTION 'authenticated can execute ledger trigger function'; END IF;
END $$;

SET ROLE postgres;
CREATE FUNCTION public.future_postgres_rpc() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN; END $$;
RESET ROLE;

DO $$
BEGIN
  IF has_function_privilege('anon','public.future_postgres_rpc()','EXECUTE') THEN RAISE EXCEPTION 'future postgres-owned RPC is public by default'; END IF;
  IF has_function_privilege('authenticated','public.future_postgres_rpc()','EXECUTE') THEN RAISE EXCEPTION 'future postgres-owned RPC is authenticated by default'; END IF;
END $$;
