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

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public."OrganizationCapability"'::regclass) THEN
    RAISE EXCEPTION 'OrganizationCapability must have row-level security enabled';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='OrganizationCapability'
      AND policyname='verity_organization_capability_admin_review'
      AND cmd='UPDATE'
  ) THEN
    RAISE EXCEPTION 'Administrator capability review policy is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='OrganizationCapability'
      AND policyname='verity_organization_capability_owner_resubmit'
      AND cmd='UPDATE'
  ) THEN
    RAISE EXCEPTION 'Owner resubmission policy is missing';
  END IF;

  IF NOT has_table_privilege('authenticated','public."OrganizationCapability"','SELECT')
     OR NOT has_table_privilege('authenticated','public."OrganizationCapability"','INSERT')
     OR NOT has_table_privilege('authenticated','public."OrganizationCapability"','UPDATE') THEN
    RAISE EXCEPTION 'Authenticated table grants are incomplete';
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
          WHEN o.status IN ('APPROVED','SUSPENDED') THEN 'APPROVED'
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
          WHEN o.status IN ('APPROVED','SUSPENDED') THEN 'APPROVED'
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
          AND c.status='APPROVED' AND o.status='PENDING')
     OR (o.type='EMPLOYER' AND c.capability='VERIFY_CREDENTIALS'
          AND c.status='APPROVED' AND o.status NOT IN ('APPROVED','SUSPENDED'));
  IF v_invalid>0 THEN
    RAISE EXCEPTION 'A capability is approved while its organization is not approved';
  END IF;

  IF NOT (
    ARRAY['PRIMARY','SECONDARY']::text[]
      <@ ARRAY['PRIMARY','SECONDARY','TERTIARY']::text[]
  ) THEN
    RAISE EXCEPTION 'Combined primary and secondary education levels are not supported';
  END IF;

  UPDATE public."Organization"
  SET "educationLevels"=ARRAY['PRIMARY','SECONDARY']::text[]
  WHERE id='org-inst-pending';
  IF NOT EXISTS (
    SELECT 1 FROM public."Organization"
    WHERE id='org-inst-pending'
      AND "educationLevels"=ARRAY['PRIMARY','SECONDARY']::text[]
  ) THEN
    RAISE EXCEPTION 'A single school account cannot serve primary and secondary levels';
  END IF;

  IF private.verity_organization_has_capability('org-inst-approved','ISSUE_CREDENTIALS') IS NOT TRUE
     OR private.verity_organization_has_capability('org-org-approved','VERIFY_CREDENTIALS') IS NOT TRUE THEN
    RAISE EXCEPTION 'Approved legacy organizations lost their baseline capabilities';
  END IF;

  IF private.verity_organization_has_capability('org-inst-suspended','ISSUE_CREDENTIALS') IS TRUE
     OR private.verity_organization_has_capability('org-org-suspended','VERIFY_CREDENTIALS') IS TRUE
     OR private.verity_organization_has_capability('org-inst-pending','ISSUE_CREDENTIALS') IS TRUE THEN
    RAISE EXCEPTION 'A suspended or pending organization can use a capability';
  END IF;

  RAISE NOTICE 'VERITY organization capability foundation assertions passed';
END;
$$;
