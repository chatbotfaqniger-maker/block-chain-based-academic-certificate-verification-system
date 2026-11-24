DO $$
DECLARE
  v_payload text;
  v_digest text;
  v_result record;
  v_message text;
BEGIN
  v_payload :=
    '{"certificateId":"VRT-2026-TEST001","studentName":"Test Graduate","studentNumber":"TEST/CS/001","institution":"Example University","faculty":"Computing","department":"Computer Science","programme":"BSc Computer Science","qualification":"Bachelor of Science","classification":"First Class","awardDate":"2026-06-30T00:00:00.000Z"}';
  v_digest := encode(extensions.digest(convert_to(v_payload,'UTF8'),'sha256'),'hex');
  IF v_digest <> '56b163ff8f9eb8e6c993fe000e0a60fe6300dd035e45d039192c0d34257a67cb' THEN
    RAISE EXCEPTION 'TEST_FAIL: PostgreSQL canonical fingerprint differs from the application JSON SHA-256 format';
  END IF;

  INSERT INTO public."Certificate" (
    id,"certificateId","verificationKey","studentName","studentNumber","studentEmail",
    institution,faculty,department,programme,qualification,classification,"awardDate","issuedAt",
    digest,status,"issuerId","organizationId"
  ) VALUES (
    'cert-1','VRT-2026-TEST001','VER-TEST-001','Test Graduate','TEST/CS/001','graduate@example.test',
    'Example University','Computing','Computer Science','BSc Computer Science','Bachelor of Science','First Class',
    '2026-06-30 00:00:00','2026-07-01 10:00:00',v_digest,'ACTIVE','user-1','org-1'
  );

  INSERT INTO public."CertificateLedger"(
    "certificateId","certificateCode","eventType","eventData","previousHash","entryHash"
  ) VALUES (
    'cert-1','VRT-2026-TEST001','ISSUED',
    jsonb_build_object('certificateId','VRT-2026-TEST001','digest',v_digest,'status','ACTIVE','issuerId','user-1','organizationId','org-1','issuedAt','2026-07-01T10:00:00'),
    repeat('0',64),repeat('a',64)
  );

  SELECT * INTO v_result FROM public.verify_verity_certificate_ledger_record('VRT-2026-TEST001');
  IF v_result.ledger_valid IS NOT TRUE OR v_result.record_matches IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST_FAIL: a valid issued certificate did not match its ledger event';
  END IF;

  BEGIN
    INSERT INTO public."Certificate" (
      id,"certificateId","verificationKey","studentName","studentNumber",institution,faculty,department,
      programme,qualification,"awardDate","issuedAt",digest,status,"issuerId","organizationId"
    ) VALUES (
      'cert-bad','VRT-2026-BAD001','VER-BAD-001','Bad Graduate','BAD/001','Example University','Computing',
      'Computer Science','BSc Computer Science','Bachelor of Science','2026-06-30','2026-07-01',
      repeat('0',64),'ACTIVE','user-1','org-1'
    );
    RAISE EXCEPTION 'TEST_FAIL: incorrect certificate fingerprint was accepted';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message LIKE 'TEST_FAIL:%' OR v_message NOT LIKE '%fingerprint%' THEN RAISE; END IF;
    IF v_message NOT LIKE '%fingerprint%' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public."Certificate" SET "studentName"='Altered Graduate' WHERE id='cert-1';
    RAISE EXCEPTION 'TEST_FAIL: issued academic identity was mutable';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message NOT LIKE '%immutable%' THEN RAISE; END IF;
  END;

  UPDATE public."Certificate"
    SET "txHash"='0x' || repeat('b',64),
        "chainId"='80002',
        "contractAddress"='0x' || repeat('c',40)
  WHERE id='cert-1';

  BEGIN
    UPDATE public."Certificate" SET "txHash"='0x' || repeat('d',64) WHERE id='cert-1';
    RAISE EXCEPTION 'TEST_FAIL: blockchain anchor could be replaced';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message NOT LIKE '%attached once%' THEN RAISE; END IF;
  END;

  UPDATE public."Certificate"
    SET status='REVOKED',"revokedAt"=now(),"revokeReason"='Test revocation'
  WHERE id='cert-1';

  INSERT INTO public."CertificateLedger"(
    "certificateId","certificateCode","eventType","eventData","previousHash","entryHash"
  ) VALUES (
    'cert-1','VRT-2026-TEST001','REVOKED',
    jsonb_build_object('certificateId','VRT-2026-TEST001','digest',v_digest,'status','REVOKED','previousStatus','ACTIVE','reason','Test revocation','revokedAt',now()),
    repeat('a',64),repeat('e',64)
  );

  SELECT * INTO v_result FROM public.verify_verity_certificate_ledger_record('VRT-2026-TEST001');
  IF v_result.ledger_valid IS NOT TRUE OR v_result.record_matches IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST_FAIL: a valid revoked certificate did not match its ledger event';
  END IF;

  BEGIN
    UPDATE public."Certificate" SET status='ACTIVE',"revokedAt"=NULL,"revokeReason"=NULL WHERE id='cert-1';
    RAISE EXCEPTION 'TEST_FAIL: revoked certificate was reactivated';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message NOT LIKE '%status transition%' THEN RAISE; END IF;
  END;

  BEGIN
    DELETE FROM public."Certificate" WHERE id='cert-1';
    RAISE EXCEPTION 'TEST_FAIL: certificate deletion was accepted';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message NOT LIKE '%cannot be deleted%' THEN RAISE; END IF;
  END;

  -- Simulate a privileged bypass to prove the verifier detects row/ledger drift.
  ALTER TABLE public."Certificate" DISABLE TRIGGER verity_guard_certificate_record;
  UPDATE public."Certificate" SET digest=repeat('f',64) WHERE id='cert-1';
  ALTER TABLE public."Certificate" ENABLE TRIGGER verity_guard_certificate_record;
  SELECT * INTO v_result FROM public.verify_verity_certificate_ledger_record('VRT-2026-TEST001');
  IF v_result.record_matches IS NOT FALSE THEN
    RAISE EXCEPTION 'TEST_FAIL: ledger verifier did not detect certificate/ledger drift';
  END IF;
END;
$$;

DO $$
DECLARE
  v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad
  FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r'
    AND (has_table_privilege('anon',c.oid,'TRUNCATE')
      OR has_table_privilege('authenticated',c.oid,'TRUNCATE')
      OR has_table_privilege('service_role',c.oid,'TRUNCATE'));
  IF v_bad<>0 THEN RAISE EXCEPTION 'TEST_FAIL: % public tables still allow application-role TRUNCATE',v_bad; END IF;

  IF has_table_privilege('service_role','public."CertificateLedger"','INSERT')
     OR has_table_privilege('service_role','public."CertificateLedger"','UPDATE')
     OR has_table_privilege('service_role','public."CertificateLedger"','DELETE')
     OR has_table_privilege('service_role','public."CertificateLedger"','TRUNCATE')
     OR NOT has_table_privilege('service_role','public."CertificateLedger"','SELECT') THEN
    RAISE EXCEPTION 'TEST_FAIL: service_role ledger privileges are not read-only';
  END IF;

  IF (SELECT bool_or(p.prosecdef) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('lookup_verity_certificate','verify_verity_certificate_ledger','verity_student_registration_precheck','verify_verity_certificate_ledger_record','verity_guard_certificate_record')) THEN
    RAISE EXCEPTION 'TEST_FAIL: internal verification/guard functions should run as SECURITY INVOKER';
  END IF;

  IF has_function_privilege('anon','public.lookup_verity_certificate(text,text,text)','EXECUTE')
     OR has_function_privilege('authenticated','public.lookup_verity_certificate(text,text,text)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.lookup_verity_certificate(text,text,text)','EXECUTE')
     OR has_function_privilege('anon','public.verify_verity_certificate_ledger(text)','EXECUTE')
     OR has_function_privilege('authenticated','public.verify_verity_certificate_ledger(text)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.verify_verity_certificate_ledger(text)','EXECUTE')
     OR has_function_privilege('anon','public.verity_student_registration_precheck(text,text)','EXECUTE')
     OR has_function_privilege('authenticated','public.verity_student_registration_precheck(text,text)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.verity_student_registration_precheck(text,text)','EXECUTE')
     OR has_function_privilege('anon','public.verify_verity_certificate_ledger_record(text)','EXECUTE')
     OR has_function_privilege('authenticated','public.verify_verity_certificate_ledger_record(text)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.verify_verity_certificate_ledger_record(text)','EXECUTE') THEN
    RAISE EXCEPTION 'TEST_FAIL: internal certificate RPC execute grants are too broad';
  END IF;

  CREATE TABLE public.default_privilege_probe(id integer);
  IF has_table_privilege('anon','public.default_privilege_probe','TRUNCATE')
     OR has_table_privilege('authenticated','public.default_privilege_probe','TRUNCATE')
     OR has_table_privilege('service_role','public.default_privilege_probe','TRUNCATE') THEN
    RAISE EXCEPTION 'TEST_FAIL: default privileges still grant TRUNCATE';
  END IF;
  DROP TABLE public.default_privilege_probe;
END;
$$;


CREATE FUNCTION public.default_privilege_probe() RETURNS integer
LANGUAGE sql AS $$ SELECT 1; $$;
SET ROLE supabase_admin;
CREATE FUNCTION public.default_privilege_probe_admin() RETURNS integer
LANGUAGE sql AS $$ SELECT 1; $$;
RESET ROLE;

DO $$
BEGIN
  IF has_function_privilege('anon','public.default_privilege_probe()','EXECUTE')
     OR has_function_privilege('authenticated','public.default_privilege_probe()','EXECUTE')
     OR NOT has_function_privilege('service_role','public.default_privilege_probe()','EXECUTE')
     OR has_function_privilege('anon','public.default_privilege_probe_admin()','EXECUTE')
     OR has_function_privilege('authenticated','public.default_privilege_probe_admin()','EXECUTE')
     OR NOT has_function_privilege('service_role','public.default_privilege_probe_admin()','EXECUTE') THEN
    RAISE EXCEPTION 'TEST_FAIL: default public function privileges still expose new RPCs to anon/authenticated';
  END IF;
END;
$$;

DROP FUNCTION public.default_privilege_probe();
DROP FUNCTION public.default_privilege_probe_admin();

SELECT 'certificate ledger integrity and permission hardening assertions passed' AS result;
