-- VERITY Student Identity & Registration Management foundation
-- Institution invitation codes do not expire unless the institution explicitly enables expiry.
ALTER TABLE public."Organization"
  ADD COLUMN IF NOT EXISTS "registrationCodeExpiryEnabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "registrationCodeExpiresAt" timestamptz;

CREATE TABLE IF NOT EXISTS public."InstitutionICTStaff" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organizationId" text NOT NULL REFERENCES public."Organization"("id") ON DELETE CASCADE,
  "userId" text NOT NULL REFERENCES public."User"("id") ON DELETE CASCADE,
  "permissions" text[] NOT NULL DEFAULT ARRAY['roster:manage','registration:recover']::text[],
  "status" text NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE','SUSPENDED')),
  "createdBy" text NOT NULL REFERENCES public."User"("id"),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "InstitutionICTStaff_permissions_check" CHECK (
    cardinality("permissions") BETWEEN 1 AND 2
    AND "permissions" <@ ARRAY['roster:manage','registration:recover']::text[]
  ),
  CONSTRAINT "InstitutionICTStaff_org_user_unique" UNIQUE ("organizationId","userId")
);
CREATE INDEX IF NOT EXISTS "InstitutionICTStaff_user_status_idx"
  ON public."InstitutionICTStaff" ("userId","status");

CREATE TABLE IF NOT EXISTS public."StudentRoster" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organizationId" text NOT NULL REFERENCES public."Organization"("id") ON DELETE CASCADE,
  "studentNumber" text NOT NULL,
  "normalizedStudentNumber" text NOT NULL,
  "fullName" text NOT NULL,
  "institutionalEmail" text,
  "faculty" text,
  "department" text,
  "programme" text,
  "academicSession" text,
  "status" text NOT NULL DEFAULT 'ELIGIBLE'
    CHECK ("status" IN ('ELIGIBLE','CLAIM_PENDING','ACTIVE','DISPUTED','BLOCKED')),
  "claimedUserId" text REFERENCES public."User"("id"),
  "claimedAt" timestamptz,
  "importBatchId" text,
  "createdBy" text NOT NULL REFERENCES public."User"("id"),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "StudentRoster_org_number_unique" UNIQUE ("organizationId","normalizedStudentNumber"),
  CONSTRAINT "StudentRoster_number_nonempty" CHECK (length(btrim("studentNumber")) BETWEEN 2 AND 80),
  CONSTRAINT "StudentRoster_normalized_nonempty" CHECK (length(btrim("normalizedStudentNumber")) BETWEEN 2 AND 80),
  CONSTRAINT "StudentRoster_name_nonempty" CHECK (length(btrim("fullName")) BETWEEN 2 AND 160)
);
CREATE INDEX IF NOT EXISTS "StudentRoster_org_status_idx"
  ON public."StudentRoster" ("organizationId","status");
CREATE INDEX IF NOT EXISTS "StudentRoster_org_name_idx"
  ON public."StudentRoster" ("organizationId",lower("fullName"));

CREATE TABLE IF NOT EXISTS public."StudentRosterImport" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organizationId" text NOT NULL REFERENCES public."Organization"("id") ON DELETE CASCADE,
  "uploadedBy" text NOT NULL REFERENCES public."User"("id"),
  "fileName" text NOT NULL,
  "totalRows" integer NOT NULL DEFAULT 0,
  "insertedRows" integer NOT NULL DEFAULT 0,
  "rejectedRows" integer NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "StudentRosterImport_org_created_idx"
  ON public."StudentRosterImport" ("organizationId","createdAt" DESC);

CREATE TABLE IF NOT EXISTS public."StudentRegistrationRecovery" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organizationId" text NOT NULL REFERENCES public."Organization"("id") ON DELETE CASCADE,
  "rosterId" text NOT NULL REFERENCES public."StudentRoster"("id") ON DELETE CASCADE,
  "reportedBy" text NOT NULL REFERENCES public."User"("id"),
  "reviewedBy" text REFERENCES public."User"("id"),
  "reason" text NOT NULL CHECK (length(btrim("reason")) BETWEEN 10 AND 1000),
  "status" text NOT NULL DEFAULT 'OPEN'
    CHECK ("status" IN ('OPEN','APPROVED','REJECTED','COMPLETED')),
  "resolutionNotes" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "resolvedAt" timestamptz
);
CREATE INDEX IF NOT EXISTS "StudentRegistrationRecovery_org_status_idx"
  ON public."StudentRegistrationRecovery" ("organizationId","status","createdAt" DESC);

ALTER TABLE public."InstitutionICTStaff" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."StudentRoster" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."StudentRosterImport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."StudentRegistrationRecovery" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Institution ICT staff can view own assignment" ON public."InstitutionICTStaff";
CREATE POLICY "Institution ICT staff can view own assignment" ON public."InstitutionICTStaff"
  FOR SELECT TO authenticated USING ("userId" = auth.uid()::text OR EXISTS (
    SELECT 1 FROM public."Organization" o WHERE o."id" = "organizationId" AND o."ownerId" = auth.uid()::text
  ));
DROP POLICY IF EXISTS "Institution owners manage ICT assignments" ON public."InstitutionICTStaff";
CREATE POLICY "Institution owners manage ICT assignments" ON public."InstitutionICTStaff"
  FOR ALL TO authenticated USING (EXISTS (
    SELECT 1 FROM public."Organization" o WHERE o."id" = "organizationId" AND o."ownerId" = auth.uid()::text
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM public."Organization" o WHERE o."id" = "organizationId" AND o."ownerId" = auth.uid()::text
  ));

DROP POLICY IF EXISTS "Institution owners and ICT can view roster" ON public."StudentRoster";
CREATE POLICY "Institution owners and ICT can view roster" ON public."StudentRoster"
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public."Organization" o WHERE o."id" = "organizationId" AND o."ownerId" = auth.uid()::text)
    OR EXISTS (SELECT 1 FROM public."InstitutionICTStaff" i WHERE i."organizationId" = "StudentRoster"."organizationId" AND i."userId" = auth.uid()::text AND i."status" = 'ACTIVE' AND 'roster:manage' = ANY(i."permissions"))
  );
DROP POLICY IF EXISTS "Institution owners and ICT manage roster" ON public."StudentRoster";
CREATE POLICY "Institution owners and ICT manage roster" ON public."StudentRoster"
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public."Organization" o WHERE o."id" = "organizationId" AND o."ownerId" = auth.uid()::text)
    OR EXISTS (SELECT 1 FROM public."InstitutionICTStaff" i WHERE i."organizationId" = "StudentRoster"."organizationId" AND i."userId" = auth.uid()::text AND i."status" = 'ACTIVE' AND 'roster:manage' = ANY(i."permissions"))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public."Organization" o WHERE o."id" = "organizationId" AND o."ownerId" = auth.uid()::text)
    OR EXISTS (SELECT 1 FROM public."InstitutionICTStaff" i WHERE i."organizationId" = "StudentRoster"."organizationId" AND i."userId" = auth.uid()::text AND i."status" = 'ACTIVE' AND 'roster:manage' = ANY(i."permissions"))
  );

DROP POLICY IF EXISTS "Institution owners and ICT view roster imports" ON public."StudentRosterImport";
CREATE POLICY "Institution owners and ICT view roster imports" ON public."StudentRosterImport"
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public."Organization" o WHERE o."id" = "organizationId" AND o."ownerId" = auth.uid()::text)
    OR EXISTS (SELECT 1 FROM public."InstitutionICTStaff" i WHERE i."organizationId" = "StudentRosterImport"."organizationId" AND i."userId" = auth.uid()::text AND i."status" = 'ACTIVE' AND 'roster:manage' = ANY(i."permissions"))
  );
DROP POLICY IF EXISTS "Institution owners and ICT create roster import audit" ON public."StudentRosterImport";
CREATE POLICY "Institution owners and ICT create roster import audit" ON public."StudentRosterImport"
  FOR INSERT TO authenticated WITH CHECK (
    "uploadedBy" = auth.uid()::text AND (
      EXISTS (SELECT 1 FROM public."Organization" o WHERE o."id" = "organizationId" AND o."ownerId" = auth.uid()::text)
      OR EXISTS (SELECT 1 FROM public."InstitutionICTStaff" i WHERE i."organizationId" = "StudentRosterImport"."organizationId" AND i."userId" = auth.uid()::text AND i."status" = 'ACTIVE' AND 'roster:manage' = ANY(i."permissions"))
    )
  );

DROP POLICY IF EXISTS "Institution owners and ICT view recovery cases" ON public."StudentRegistrationRecovery";
CREATE POLICY "Institution owners and ICT view recovery cases" ON public."StudentRegistrationRecovery"
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public."Organization" o WHERE o."id" = "organizationId" AND o."ownerId" = auth.uid()::text)
    OR EXISTS (SELECT 1 FROM public."InstitutionICTStaff" i WHERE i."organizationId" = "StudentRegistrationRecovery"."organizationId" AND i."userId" = auth.uid()::text AND i."status" = 'ACTIVE' AND 'registration:recover' = ANY(i."permissions"))
  );
DROP POLICY IF EXISTS "Institution owners and ICT create recovery cases" ON public."StudentRegistrationRecovery";
CREATE POLICY "Institution owners and ICT create recovery cases" ON public."StudentRegistrationRecovery"
  FOR INSERT TO authenticated WITH CHECK (
    "reportedBy" = auth.uid()::text AND (
      EXISTS (SELECT 1 FROM public."Organization" o WHERE o."id" = "organizationId" AND o."ownerId" = auth.uid()::text)
      OR EXISTS (SELECT 1 FROM public."InstitutionICTStaff" i WHERE i."organizationId" = "StudentRegistrationRecovery"."organizationId" AND i."userId" = auth.uid()::text AND i."status" = 'ACTIVE' AND 'registration:recover' = ANY(i."permissions"))
    )
  );
DROP POLICY IF EXISTS "Institution owners and ICT resolve recovery cases" ON public."StudentRegistrationRecovery";
CREATE POLICY "Institution owners and ICT resolve recovery cases" ON public."StudentRegistrationRecovery"
  FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM public."Organization" o WHERE o."id" = "organizationId" AND o."ownerId" = auth.uid()::text)
    OR EXISTS (SELECT 1 FROM public."InstitutionICTStaff" i WHERE i."organizationId" = "StudentRegistrationRecovery"."organizationId" AND i."userId" = auth.uid()::text AND i."status" = 'ACTIVE' AND 'registration:recover' = ANY(i."permissions"))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public."Organization" o WHERE o."id" = "organizationId" AND o."ownerId" = auth.uid()::text)
    OR EXISTS (SELECT 1 FROM public."InstitutionICTStaff" i WHERE i."organizationId" = "StudentRegistrationRecovery"."organizationId" AND i."userId" = auth.uid()::text AND i."status" = 'ACTIVE' AND 'registration:recover' = ANY(i."permissions"))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public."InstitutionICTStaff" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."StudentRoster" TO authenticated;
GRANT SELECT, INSERT ON public."StudentRosterImport" TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public."StudentRegistrationRecovery" TO authenticated;
