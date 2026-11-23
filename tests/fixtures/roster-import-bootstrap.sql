CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
CREATE FUNCTION private.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
GRANT USAGE ON SCHEMA public,auth,private TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.is_admin() TO authenticated,service_role;

CREATE TABLE public."User" (
  id text PRIMARY KEY,
  "fullName" text,
  email text,
  role text
);
CREATE TABLE public."Organization" (
  id text PRIMARY KEY,
  name text NOT NULL,
  type text NOT NULL,
  status text NOT NULL,
  "ownerId" text NOT NULL
);
CREATE TABLE public."InstitutionICTStaff" (
  id text PRIMARY KEY,
  "organizationId" text NOT NULL REFERENCES public."Organization"(id),
  "userId" text NOT NULL REFERENCES public."User"(id),
  permissions text[] NOT NULL,
  status text NOT NULL
);
CREATE TABLE public."StudentRoster" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organizationId" text NOT NULL REFERENCES public."Organization"(id) ON DELETE CASCADE,
  "studentNumber" text NOT NULL,
  "normalizedStudentNumber" text NOT NULL,
  "fullName" text NOT NULL,
  "institutionalEmail" text,
  faculty text,
  department text,
  programme text,
  "academicSession" text,
  status text NOT NULL DEFAULT 'ELIGIBLE' CHECK(status IN ('ELIGIBLE','CLAIM_PENDING','ACTIVE','DISPUTED','BLOCKED')),
  "claimedUserId" text REFERENCES public."User"(id),
  "claimedAt" timestamptz,
  "importBatchId" text,
  "createdBy" text NOT NULL REFERENCES public."User"(id),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "StudentRoster_name_nonempty" CHECK(length(btrim("fullName"))>=2),
  CONSTRAINT "StudentRoster_normalized_nonempty" CHECK(length(btrim("normalizedStudentNumber"))>=2),
  CONSTRAINT "StudentRoster_number_nonempty" CHECK(length(btrim("studentNumber"))>=2),
  CONSTRAINT "StudentRoster_org_number_unique" UNIQUE("organizationId","normalizedStudentNumber")
);
CREATE TABLE public."StudentRosterImport" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organizationId" text NOT NULL REFERENCES public."Organization"(id) ON DELETE CASCADE,
  "uploadedBy" text NOT NULL REFERENCES public."User"(id),
  "fileName" text NOT NULL,
  "totalRows" integer NOT NULL DEFAULT 0,
  "insertedRows" integer NOT NULL DEFAULT 0,
  "rejectedRows" integer NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public."StudentRoster" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."StudentRosterImport" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Institution owners and ICT can view roster" ON public."StudentRoster"
  FOR SELECT TO authenticated USING (
    EXISTS(SELECT 1 FROM public."Organization" o WHERE o.id="StudentRoster"."organizationId" AND o."ownerId"=(SELECT auth.uid())::text)
    OR EXISTS(SELECT 1 FROM public."InstitutionICTStaff" i WHERE i."organizationId"="StudentRoster"."organizationId" AND i."userId"=(SELECT auth.uid())::text AND i.status='ACTIVE' AND 'roster:manage'=ANY(i.permissions))
  );
CREATE POLICY "Institution owners and ICT manage roster" ON public."StudentRoster"
  FOR ALL TO authenticated USING (
    EXISTS(SELECT 1 FROM public."Organization" o WHERE o.id="StudentRoster"."organizationId" AND o."ownerId"=(SELECT auth.uid())::text)
    OR EXISTS(SELECT 1 FROM public."InstitutionICTStaff" i WHERE i."organizationId"="StudentRoster"."organizationId" AND i."userId"=(SELECT auth.uid())::text AND i.status='ACTIVE' AND 'roster:manage'=ANY(i.permissions))
  ) WITH CHECK (
    EXISTS(SELECT 1 FROM public."Organization" o WHERE o.id="StudentRoster"."organizationId" AND o."ownerId"=(SELECT auth.uid())::text)
    OR EXISTS(SELECT 1 FROM public."InstitutionICTStaff" i WHERE i."organizationId"="StudentRoster"."organizationId" AND i."userId"=(SELECT auth.uid())::text AND i.status='ACTIVE' AND 'roster:manage'=ANY(i.permissions))
  );
CREATE POLICY "Institution owners and ICT view roster imports" ON public."StudentRosterImport"
  FOR SELECT TO authenticated USING (
    EXISTS(SELECT 1 FROM public."Organization" o WHERE o.id="StudentRosterImport"."organizationId" AND o."ownerId"=(SELECT auth.uid())::text)
    OR EXISTS(SELECT 1 FROM public."InstitutionICTStaff" i WHERE i."organizationId"="StudentRosterImport"."organizationId" AND i."userId"=(SELECT auth.uid())::text AND i.status='ACTIVE' AND 'roster:manage'=ANY(i.permissions))
  );
CREATE POLICY "Institution owners and ICT create roster import audit" ON public."StudentRosterImport"
  FOR INSERT TO authenticated WITH CHECK (
    "uploadedBy"=(SELECT auth.uid())::text
    AND (EXISTS(SELECT 1 FROM public."Organization" o WHERE o.id="StudentRosterImport"."organizationId" AND o."ownerId"=(SELECT auth.uid())::text)
    OR EXISTS(SELECT 1 FROM public."InstitutionICTStaff" i WHERE i."organizationId"="StudentRosterImport"."organizationId" AND i."userId"=(SELECT auth.uid())::text AND i.status='ACTIVE' AND 'roster:manage'=ANY(i.permissions)))
  );
GRANT SELECT,INSERT,UPDATE ON public."StudentRoster" TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public."StudentRosterImport" TO authenticated;
GRANT SELECT ON public."Organization" TO authenticated;
GRANT SELECT ON public."InstitutionICTStaff" TO authenticated;
GRANT ALL ON public."StudentRoster" TO service_role;
GRANT ALL ON public."StudentRosterImport" TO service_role;
GRANT SELECT ON public."Organization" TO service_role;
GRANT SELECT ON public."InstitutionICTStaff" TO service_role;
