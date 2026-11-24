-- VERITY additive organization capabilities and school education levels.
-- This migration does not change existing organization types, certificate records,
-- template assets, storage buckets, issuance methods, or queue limits.

ALTER TABLE public."Organization"
  ADD COLUMN IF NOT EXISTS "educationLevels" text[] NOT NULL DEFAULT ARRAY[]::text[];

UPDATE public."Organization"
SET "educationLevels" = ARRAY['TERTIARY']::text[]
WHERE type = 'INSTITUTION'
  AND cardinality("educationLevels") = 0;

ALTER TABLE public."Organization"
  DROP CONSTRAINT IF EXISTS "Organization_education_levels_check";

ALTER TABLE public."Organization"
  ADD CONSTRAINT "Organization_education_levels_check"
  CHECK (
    cardinality("educationLevels") <= 3
    AND "educationLevels" <@ ARRAY['PRIMARY','SECONDARY','TERTIARY']::text[]
  );

COMMENT ON COLUMN public."Organization"."educationLevels" IS
  'Education levels served by this organization. A school serving primary and secondary education uses one organization account with both values.';

CREATE TABLE IF NOT EXISTS public."OrganizationCapability" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organizationId" text NOT NULL REFERENCES public."Organization"(id) ON DELETE CASCADE,
  capability text NOT NULL
    CHECK (capability IN ('ISSUE_CREDENTIALS','VERIFY_CREDENTIALS')),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','APPROVED','REJECTED','SUSPENDED')),
  "requestedBy" text NOT NULL REFERENCES public."User"(id),
  "reviewedBy" text REFERENCES public."User"(id),
  "requestNote" text CHECK ("requestNote" IS NULL OR char_length("requestNote") <= 1000),
  "decisionNote" text CHECK ("decisionNote" IS NULL OR char_length("decisionNote") <= 1000),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "reviewedAt" timestamptz,
  CONSTRAINT "OrganizationCapability_org_capability_unique"
    UNIQUE ("organizationId", capability)
);

CREATE INDEX IF NOT EXISTS "OrganizationCapability_status_created_idx"
  ON public."OrganizationCapability" (status, "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "OrganizationCapability_org_status_idx"
  ON public."OrganizationCapability" ("organizationId", status);

-- Preserve the exact capabilities existing organizations already have.
-- No new capability is granted to an existing organization by this backfill.
INSERT INTO public."OrganizationCapability"
  (id, "organizationId", capability, status, "requestedBy", "requestNote", "decisionNote", "createdAt", "updatedAt", "reviewedAt")
SELECT
  gen_random_uuid()::text,
  o.id,
  CASE WHEN o.type = 'INSTITUTION' THEN 'ISSUE_CREDENTIALS' ELSE 'VERIFY_CREDENTIALS' END,
  CASE
    WHEN o.status IN ('APPROVED','SUSPENDED') THEN 'APPROVED'
    ELSE 'PENDING'
  END,
  o."ownerId",
  'Existing organization capability preserved during additive VERITY expansion.',
  'Backfilled from the organization type and approval state that existed before this migration.',
  now(),
  now(),
  CASE WHEN o.status IN ('APPROVED','SUSPENDED') THEN now() ELSE NULL END
FROM public."Organization" o
WHERE o.type IN ('INSTITUTION','EMPLOYER')
  AND o."ownerId" IS NOT NULL
ON CONFLICT ("organizationId", capability) DO NOTHING;

ALTER TABLE public."OrganizationCapability" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS verity_organization_capability_owner_read
  ON public."OrganizationCapability";
CREATE POLICY verity_organization_capability_owner_read
  ON public."OrganizationCapability"
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public."Organization" o
      WHERE o.id = "OrganizationCapability"."organizationId"
        AND o."ownerId" = (SELECT auth.uid())::text
    )
    OR (SELECT private.is_admin())
  );

DROP POLICY IF EXISTS verity_organization_capability_owner_request
  ON public."OrganizationCapability";
CREATE POLICY verity_organization_capability_owner_request
  ON public."OrganizationCapability"
  FOR INSERT TO authenticated
  WITH CHECK (
    status = 'PENDING'
    AND "reviewedBy" IS NULL
    AND "reviewedAt" IS NULL
    AND "requestedBy" = (SELECT auth.uid())::text
    AND EXISTS (
      SELECT 1 FROM public."Organization" o
      WHERE o.id = "OrganizationCapability"."organizationId"
        AND o."ownerId" = (SELECT auth.uid())::text
    )
  );

REVOKE ALL ON public."OrganizationCapability" FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public."OrganizationCapability" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."OrganizationCapability" TO service_role;

-- Only platform administrators may record a capability decision.
DROP POLICY IF EXISTS verity_organization_capability_admin_review
  ON public."OrganizationCapability";
CREATE POLICY verity_organization_capability_admin_review
  ON public."OrganizationCapability"
  FOR UPDATE TO authenticated
  USING ((SELECT private.is_admin()))
  WITH CHECK (
    (SELECT private.is_admin())
    AND status IN ('PENDING','APPROVED','REJECTED','SUSPENDED')
  );

-- An organization owner may resubmit a previously rejected capability request,
-- but cannot approve, suspend, or otherwise grant the capability to themselves.
DROP POLICY IF EXISTS verity_organization_capability_owner_resubmit
  ON public."OrganizationCapability";
CREATE POLICY verity_organization_capability_owner_resubmit
  ON public."OrganizationCapability"
  FOR UPDATE TO authenticated
  USING (
    status = 'REJECTED'
    AND "requestedBy" = (SELECT auth.uid())::text
    AND EXISTS (
      SELECT 1 FROM public."Organization" o
      WHERE o.id = "OrganizationCapability"."organizationId"
        AND o."ownerId" = (SELECT auth.uid())::text
    )
  )
  WITH CHECK (
    status = 'PENDING'
    AND "requestedBy" = (SELECT auth.uid())::text
    AND "reviewedBy" IS NULL
    AND "reviewedAt" IS NULL
    AND EXISTS (
      SELECT 1 FROM public."Organization" o
      WHERE o.id = "OrganizationCapability"."organizationId"
        AND o."ownerId" = (SELECT auth.uid())::text
    )
  );

-- Shared authorization primitive for later backend and RLS integration.
-- Organization-level approval is always required in addition to the capability.
CREATE OR REPLACE FUNCTION private.verity_organization_has_capability(
  p_organization_id text,
  p_capability text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."Organization" o
    JOIN public."OrganizationCapability" c
      ON c."organizationId" = o.id
    WHERE o.id = p_organization_id
      AND o.status = 'APPROVED'
      AND c.capability = p_capability
      AND c.status = 'APPROVED'
  );
$$;

REVOKE ALL ON FUNCTION private.verity_organization_has_capability(text,text)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION private.verity_organization_has_capability(text,text)
  TO authenticated, service_role;

COMMENT ON TABLE public."OrganizationCapability" IS
  'Separate, independently reviewed organization permissions for credential issuance and external credential verification. Existing organization type values remain unchanged.';
