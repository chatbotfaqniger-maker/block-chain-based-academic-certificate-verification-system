\set ON_ERROR_STOP on
DO $$
DECLARE
  v_template public."InstitutionCertificateTemplate"%rowtype;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public."InstitutionCertificateTemplate"'::regclass) THEN
    RAISE EXCEPTION 'Template table must have RLS enabled';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public."CertificateDigitizationCase"'::regclass) THEN
    RAISE EXCEPTION 'Digitisation case table must have RLS enabled';
  END IF;
  IF has_table_privilege('anon','public."InstitutionCertificateTemplate"','SELECT')
     OR has_table_privilege('anon','public."CertificateDigitizationCase"','SELECT') THEN
    RAISE EXCEPTION 'Anonymous users must not read institution templates or digitisation cases';
  END IF;
  IF has_table_privilege('authenticated','public."InstitutionCertificateTemplate"','INSERT')
     OR has_table_privilege('authenticated','public."CertificateDigitizationCase"','INSERT') THEN
    RAISE EXCEPTION 'Browser roles must not write template or digitisation metadata directly';
  END IF;
  IF NOT has_table_privilege('service_role','public."InstitutionCertificateTemplate"','INSERT')
     OR NOT has_table_privilege('service_role','public."CertificateDigitizationCase"','INSERT') THEN
    RAISE EXCEPTION 'Service role must be able to perform protected server writes';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='InstitutionCertificateTemplate_one_default_per_org') THEN
    RAISE EXCEPTION 'One active default template per institution index is missing';
  END IF;
END $$;

INSERT INTO public."User"(id) VALUES ('11111111-1111-4111-8111-111111111111');
INSERT INTO public."Organization"(id,"ownerId",type,status)
VALUES ('org-a','11111111-1111-4111-8111-111111111111','INSTITUTION','APPROVED');

INSERT INTO public."InstitutionCertificateTemplate"(
  id,"organizationId",name,"sourceType","templateKey","pageSize","fieldLayout",status,"isDefault","createdBy","updatedBy"
) VALUES (
  'template-a','org-a','VERITY Classic','VERITY_TEMPLATE','verity-classic','A4_LANDSCAPE','{}','ACTIVE',true,
  '11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111'
);
DO $$
BEGIN
  BEGIN
    INSERT INTO public."InstitutionCertificateTemplate"(
      id,"organizationId",name,"sourceType","templateKey","pageSize","fieldLayout",status,"isDefault","createdBy","updatedBy"
    ) VALUES (
      'template-b','org-a','Second default','VERITY_TEMPLATE','verity-modern','A4_LANDSCAPE','{}','ACTIVE',true,
      '11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111'
    );
    RAISE EXCEPTION 'Duplicate active default template unexpectedly accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public."CertificateDigitizationCase"(
      id,"organizationId","submittedBy","studentNumber","claimedStudentName","credentialData",
      "sourceStoragePath","sourceFileName","sourceMimeType","sourceSizeBytes","sourceSha256",status
    ) VALUES (
      'case-invalid','org-a','11111111-1111-4111-8111-111111111111','MAT-001','Student One','{}',
      'digitization/org-a/case-invalid/source.pdf','source.pdf','application/pdf',100,repeat('a',64),'APPROVED'
    );
    RAISE EXCEPTION 'Approved case without reviewer was unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;


-- Historical conversion must be owner-only, approved-only, atomic and idempotent.
DO $$
DECLARE
  v_result jsonb;
  v_again jsonb;
  v_certificate_id text := 'VRT-2026-HIST0001';
  v_case_id text := 'case-approved-conversion';
BEGIN
  INSERT INTO public."CertificateDigitizationCase"(
    id,"organizationId","submittedBy","reviewedBy","studentNumber","claimedStudentName",
    "credentialData","sourceStoragePath","sourceFileName","sourceMimeType","sourceSizeBytes",
    "sourceSha256",status,"reviewedAt"
  ) VALUES (
    v_case_id,'org-a','11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111','MAT-2020-001','Student Historical',
    '{"faculty":"Science","department":"Computer Science","programme":"Computing","qualification":"BSc","awardDate":"2020-11-20T00:00:00.000Z"}',
    'digitization/org-a/case-approved-conversion/source.pdf','source.pdf','application/pdf',100,repeat('b',64),
    'APPROVED',now()
  );

  v_result := public.verity_convert_digitization_case(v_case_id,jsonb_build_object(
    'id','certificate-historical-1','certificateId',v_certificate_id,
    'verificationKey','VRT-HISTORICAL-KEY-0001','studentName','Student Historical',
    'studentEmail',null,'studentNumber','MAT-2020-001','institution','Institution A',
    'faculty','Science','department','Computer Science','programme','Computing',
    'qualification','BSc','classification',null,'awardDate','2020-11-20T00:00:00.000Z',
    'issuedAt',now(),'digest',repeat('c',64),'txHash',null,'chainId',null,
    'contractAddress',null,'status','ACTIVE','revokedAt',null,'revokeReason',null,
    'graduateId',null,'issuerId','11111111-1111-4111-8111-111111111111',
    'organizationId','org-a','createdAt',now(),'updatedAt',now()
  ));

  IF v_result->>'certificateId' <> v_certificate_id THEN
    RAISE EXCEPTION 'Conversion did not return the created certificate';
  END IF;
  IF (SELECT status FROM public."CertificateDigitizationCase" WHERE id=v_case_id) <> 'ISSUED' THEN
    RAISE EXCEPTION 'Approved case was not transitioned to ISSUED';
  END IF;
  IF (SELECT count(*) FROM public."CertificateLedger" WHERE "certificateId"=v_certificate_id) <> 1 THEN
    RAISE EXCEPTION 'Canonical certificate insert did not append exactly one ledger event';
  END IF;

  v_again := public.verity_convert_digitization_case(v_case_id,'{}'::jsonb);
  IF v_again->>'certificateId' <> v_certificate_id THEN
    RAISE EXCEPTION 'Repeated conversion did not return the original certificate';
  END IF;
  IF (SELECT count(*) FROM public."CertificateLedger" WHERE "certificateId"=v_certificate_id) <> 1 THEN
    RAISE EXCEPTION 'Repeated conversion created a duplicate ledger event';
  END IF;

  IF has_function_privilege('anon','public.verity_convert_digitization_case(text,jsonb)','EXECUTE')
     OR has_function_privilege('authenticated','public.verity_convert_digitization_case(text,jsonb)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.verity_convert_digitization_case(text,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'Historical conversion RPC execution grants are incorrect';
  END IF;
END $$;
