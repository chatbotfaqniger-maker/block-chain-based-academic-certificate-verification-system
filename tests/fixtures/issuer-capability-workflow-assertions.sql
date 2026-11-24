-- Run after 20261124150000_organization_capabilities_and_school_levels.sql
-- and 20261124153000_enable_capability_based_issuer_workflows.sql.

DO $$
DECLARE
  v_definition text;
BEGIN
  -- Student onboarding must discover any approved credential issuer, not only
  -- organizations whose legacy type happens to be INSTITUTION.
  v_definition := pg_get_functiondef('public.verity_student_signup_institutions()'::regprocedure);
  IF position('ISSUE_CREDENTIALS' in v_definition)=0 THEN
    RAISE EXCEPTION 'Student signup options do not use approved issuer capability';
  END IF;

  v_definition := pg_get_functiondef('public.verity_student_registration_precheck(text,text)'::regprocedure);
  IF position('ISSUE_CREDENTIALS' in v_definition)=0 THEN
    RAISE EXCEPTION 'Student registration precheck does not use approved issuer capability';
  END IF;

  v_definition := pg_get_functiondef('public.activate_verity_student_roster(text,text,text)'::regprocedure);
  IF position('ISSUE_CREDENTIALS' in v_definition)=0 THEN
    RAISE EXCEPTION 'Student activation does not require approved issuer capability';
  END IF;

  v_definition := pg_get_functiondef('public.list_verity_student_roster(text,text)'::regprocedure);
  IF position('ISSUE_CREDENTIALS' in v_definition)=0 THEN
    RAISE EXCEPTION 'Roster listing does not require approved issuer capability';
  END IF;

  v_definition := pg_get_functiondef('public.request_verity_membership(text,text)'::regprocedure);
  IF position('ISSUE_CREDENTIALS' in v_definition)=0 THEN
    RAISE EXCEPTION 'Membership requests are not restricted to approved issuers';
  END IF;

  v_definition := pg_get_functiondef('public.lookup_verity_certificate_for_org(text)'::regprocedure);
  IF position('VERIFY_CREDENTIALS' in v_definition)=0 THEN
    RAISE EXCEPTION 'Organization verification RPC does not require verifier capability';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='Certificate'
      AND policyname='verity_certificate_admin_insert'
      AND with_check ILIKE '%ISSUE_CREDENTIALS%'
  ) THEN
    RAISE EXCEPTION 'Certificate insertion is not protected by issuer capability';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='CertificateAccessGrant'
      AND policyname='verity_certificate_grant_insert_org'
      AND with_check ILIKE '%VERIFY_CREDENTIALS%'
  ) THEN
    RAISE EXCEPTION 'Graduate document access requests are not protected by verifier capability';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND policyname='verity_private_certificate_upload'
      AND with_check ILIKE '%ISSUE_CREDENTIALS%'
  ) THEN
    RAISE EXCEPTION 'Private certificate uploads are not protected by issuer capability';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND policyname='verity_storage_granted_verifier_read'
      AND qual ILIKE '%VERIFY_CREDENTIALS%'
  ) THEN
    RAISE EXCEPTION 'Consent-based private document access is not protected by verifier capability';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='StudentImportChunk'
      AND policyname='verity_student_import_chunk_roster_insert'
      AND with_check ILIKE '%ISSUE_CREDENTIALS%'
  ) THEN
    RAISE EXCEPTION 'Roster chunk uploads are not protected by issuer capability';
  END IF;

  IF has_function_privilege('anon','public.verity_student_registration_precheck(text,text)','EXECUTE')
     OR has_function_privilege('authenticated','public.verity_student_registration_precheck(text,text)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.verity_student_registration_precheck(text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Private student roster precheck must be service-role only';
  END IF;

  IF has_function_privilege('anon','public.lookup_verity_certificate_for_org(text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.lookup_verity_certificate_for_org(text)','EXECUTE') THEN
    RAISE EXCEPTION 'External verification RPC execution grants are not restricted to authenticated callers';
  END IF;

  IF NOT has_function_privilege('anon','public.verity_student_signup_institutions()','EXECUTE') THEN
    RAISE EXCEPTION 'Public graduate signup cannot list approved credential issuers';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public."CertificateIssuanceBatch"'::regclass
      AND contype='c'
      AND pg_get_constraintdef(oid) ILIKE '%500%'
  ) THEN
    RAISE EXCEPTION 'The existing 500-item bulk certificate batch constraint was not preserved';
  END IF;

  RAISE NOTICE 'VERITY issuer/verifier capability workflow assertions passed';
END;
$$;
