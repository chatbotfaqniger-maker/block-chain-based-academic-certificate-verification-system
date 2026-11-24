-- VERITY organization capability / school-level migration assertions.
-- Run after 20261124150000_organization_capabilities_and_school_levels.sql.

DO $$
DECLARE
  v_missing integer;
  v_invalid integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='Organization'
      AND column_name='educationLevels' AND data_type='ARRAY'
  ) THEN
    RAISE EXCEPTION 'Organization.educationLevels was not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='OrganizationCapability'
  ) THEN
    RAISE EXCEPTION 'OrganizationCapability table was not created';
  END IF;

  IF to_regprocedure('private.verity_organization_has_capability(text,text)') IS NULL THEN
    RAISE EXCEPTION 'Capability authorization function was not created';
  END IF;

  SELECT count(*) INTO v_missing
  FROM public."Organization" o
  WHERE o.type='INSTITUTION'
    AND o."ownerId" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public."OrganizationCapability" c
      WHERE c."organizationId"=o.id
        AND c.capability='ISSUE_CREDENTIALS'
        AND c.status=CASE
          WHEN o.status='APPROVED' THEN 'APPROVED'
          WHEN o.status='SUSPENDED' THEN 'SUSPENDED'
          ELSE 'PENDING'
        END
    );
  IF v_missing>0 THEN
    RAISE EXCEPTION 'Existing institution issuer capabilities were not preserved for % organizations',v_missing;
  END IF;

  SELECT count(*) INTO v_missing
  FROM public."Organization" o
  WHERE o.type='EMPLOYER'
    AND o."ownerId" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public."OrganizationCapability" c
      WHERE c."organizationId"=o.id
        AND c.capability='VERIFY_CREDENTIALS'
        AND c.status=CASE
          WHEN o.status='APPROVED' THEN 'APPROVED'
          WHEN o.status='SUSPENDED' THEN 'SUSPENDED'
          ELSE 'PENDING'
        END
    );
  IF v_missing>0 THEN
    RAISE EXCEPTION 'Existing verifier capabilities were not preserved for % organizations',v_missing;
  END IF;

  SELECT count(*) INTO v_invalid
  FROM public."OrganizationCapability" c
  JOIN public."Organization" o ON o.id=c."organizationId"
  WHERE (o.type='INSTITUTION' AND c.capability='ISSUE_CREDENTIALS'
          AND c.status='APPROVED' AND o.status<>'APPROVED')
     OR (o.type='EMPLOYER' AND c.capability='VERIFY_CREDENTIALS'
          AND c.status='APPROVED' AND o.status<>'APPROVED');
  IF v_invalid>0 THEN
    RAISE EXCEPTION 'A capability is approved while its organization is not approved';
  END IF;

  IF NOT (
    ARRAY['PRIMARY','SECONDARY']::text[]
      <@ ARRAY['PRIMARY','SECONDARY','TERTIARY']::text[]
  ) THEN
    RAISE EXCEPTION 'Combined primary and secondary education levels are not supported';
  END IF;

  RAISE NOTICE 'VERITY organization capability foundation assertions passed';
END;
$$;
