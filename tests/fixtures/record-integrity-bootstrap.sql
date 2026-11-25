\i tests/fixtures/roster-import-bootstrap.sql

CREATE TABLE public."AuditEvent" (
  id text PRIMARY KEY,
  "actorId" text NOT NULL,
  action text NOT NULL,
  entity text NOT NULL,
  "entityId" text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public."Certificate" (
  id text PRIMARY KEY,
  "certificateId" text NOT NULL UNIQUE,
  digest text NOT NULL,
  "organizationId" text NOT NULL REFERENCES public."Organization"(id),
  status text NOT NULL CHECK (status IN ('ACTIVE','REVOKED'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."AuditEvent", public."Certificate" TO service_role, authenticated;
ALTER TABLE public."AuditEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Certificate" ENABLE ROW LEVEL SECURITY;

CREATE POLICY record_integrity_certificate_read
  ON public."Certificate" FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public."Organization" o
      WHERE o.id="Certificate"."organizationId" AND o."ownerId"=(SELECT auth.uid())::text)
    OR EXISTS (SELECT 1 FROM public."InstitutionICTStaff" i
      WHERE i."organizationId"="Certificate"."organizationId"
        AND i."userId"=(SELECT auth.uid())::text AND i.status='ACTIVE'
        AND 'roster:manage'=ANY(i.permissions))
  );
