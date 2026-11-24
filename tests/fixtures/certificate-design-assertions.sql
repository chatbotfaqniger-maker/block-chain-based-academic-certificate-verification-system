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


-- Historical conversion is intentionally deferred until its complete schema,
-- review workflow and atomic RPC are implemented and released together.
DO $$
BEGIN
  IF to_regprocedure('public.verity_convert_digitization_case(text,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'Deferred historical conversion RPC must not be exposed in this release';
  END IF;
END $$;
