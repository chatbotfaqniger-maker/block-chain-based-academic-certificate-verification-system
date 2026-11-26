-- Minimal Supabase Storage/RLS contract fixture for VERITY's deferred-scanner launch policy.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE SCHEMA storage;

CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

CREATE TABLE public."User" (id text PRIMARY KEY, role text NOT NULL);
CREATE TABLE public."Organization" (
  id text PRIMARY KEY, "ownerId" text NOT NULL, status text NOT NULL, type text NOT NULL
);
CREATE TABLE public."OrganizationCapability" (
  id text PRIMARY KEY, "organizationId" text NOT NULL, capability text NOT NULL, status text NOT NULL
);
CREATE TYPE public."CertificateStatus" AS ENUM ('ACTIVE','REVOKED');
CREATE TABLE public."Certificate" (
  id text PRIMARY KEY, "organizationId" text NOT NULL, "graduateId" text,
  status public."CertificateStatus" NOT NULL DEFAULT 'ACTIVE'
);
CREATE TABLE public."CertificateDocument" (
  id text PRIMARY KEY, "certificateId" text NOT NULL, "organizationId" text NOT NULL,
  "storagePath" text NOT NULL, "scanStatus" text NOT NULL DEFAULT 'NOT_SCANNED'
);
CREATE TABLE public."CertificateAccessGrant" (
  id text PRIMARY KEY, "certificateId" text NOT NULL, "organizationId" text NOT NULL,
  status text NOT NULL, "expiresAt" timestamptz NOT NULL
);
CREATE TABLE public."InstitutionICTStaff" (
  id text PRIMARY KEY, "organizationId" text NOT NULL, "userId" text NOT NULL,
  status text NOT NULL, permissions text[] NOT NULL DEFAULT '{}'
);

CREATE FUNCTION private.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$ SELECT EXISTS (SELECT 1 FROM public."User" u WHERE u.id=(SELECT auth.uid())::text AND u.role='ADMIN') $$;
CREATE FUNCTION private.is_active_org_staff(p_org text,p_permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$ SELECT EXISTS (
  SELECT 1 FROM public."InstitutionICTStaff" s
  WHERE s."organizationId"=p_org AND s."userId"=(SELECT auth.uid())::text
    AND s.status='ACTIVE' AND p_permission=ANY(s.permissions)
) $$;
CREATE FUNCTION private.verity_organization_has_capability(p_org text,p_capability text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$ SELECT EXISTS (
  SELECT 1 FROM public."OrganizationCapability" c
  WHERE c."organizationId"=p_org AND c.capability=p_capability AND c.status='APPROVED'
) $$;

CREATE TABLE storage.objects (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, bucket_id text NOT NULL, name text NOT NULL);
CREATE FUNCTION storage.foldername(p_name text) RETURNS text[]
LANGUAGE sql IMMUTABLE
AS $$ SELECT (string_to_array(p_name,'/'))[1:array_length(string_to_array(p_name,'/'),1)-1] $$;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA auth,private,storage TO anon,authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth,private,storage TO anon,authenticated;
GRANT SELECT ON storage.objects TO anon,authenticated;
GRANT SELECT ON public."User",public."Organization",public."OrganizationCapability",
  public."Certificate",public."CertificateDocument",public."CertificateAccessGrant",
  public."InstitutionICTStaff" TO authenticated;

-- This is the existing graduate-consent verifier policy. The launch-policy migration
-- must not remove or weaken its approved, unexpired grant and issuer-capability checks.
CREATE POLICY verity_storage_granted_verifier_read ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id='verity-certificates'
  AND EXISTS (
    SELECT 1
    FROM public."CertificateDocument" d
    JOIN public."Certificate" c ON c.id=d."certificateId" AND c."organizationId"=d."organizationId"
    JOIN public."CertificateAccessGrant" g ON g."certificateId"=d."certificateId"
    JOIN public."Organization" o ON o.id=g."organizationId"
    WHERE d."storagePath"=objects.name
      AND d."organizationId"=(storage.foldername(objects.name))[1]
      AND d."certificateId"=(storage.foldername(objects.name))[2]
      AND g.status='APPROVED' AND g."expiresAt">now()
      AND c.status='ACTIVE' AND o."ownerId"=(SELECT auth.uid())::text
      AND private.verity_organization_has_capability(o.id,'VERIFY_CREDENTIALS')
  )
);

-- The production policy being replaced is deliberately represented with the CLEAN gate.
CREATE POLICY verity_private_certificate_read ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id='verity-certificates'
  AND EXISTS (
    SELECT 1 FROM public."CertificateDocument" d
    JOIN public."Certificate" c ON c.id=d."certificateId" AND c."organizationId"=d."organizationId"
    WHERE d."storagePath"=objects.name
      AND d."organizationId"=(storage.foldername(objects.name))[1]
      AND d."certificateId"=(storage.foldername(objects.name))[2]
      AND d."scanStatus"='CLEAN'
      AND ((SELECT private.is_admin())
        OR EXISTS (SELECT 1 FROM public."Organization" o
          WHERE o.id=d."organizationId" AND o."ownerId"=auth.uid()::text AND o.status='APPROVED')
        OR c."graduateId"=auth.uid()::text
        OR private.is_active_org_staff(d."organizationId",'documents:download'))
  )
);

INSERT INTO public."User"(id,role) VALUES
 ('10000000-0000-4000-8000-000000000001','EMPLOYER'),
 ('20000000-0000-4000-8000-000000000002','EMPLOYER'),
 ('30000000-0000-4000-8000-000000000003','GRADUATE'),
 ('40000000-0000-4000-8000-000000000004','GRADUATE'),
 ('50000000-0000-4000-8000-000000000005','ADMIN'),
 ('60000000-0000-4000-8000-000000000006','EMPLOYER'),
 ('70000000-0000-4000-8000-000000000007','EMPLOYER');

INSERT INTO public."Organization"(id,"ownerId",status,type) VALUES
 ('org-institution','10000000-0000-4000-8000-000000000001','APPROVED','INSTITUTION'),
 ('org-employer-issuer','20000000-0000-4000-8000-000000000002','APPROVED','EMPLOYER'),
 ('org-verifier','60000000-0000-4000-8000-000000000006','APPROVED','EMPLOYER'),
 ('org-expired-verifier','70000000-0000-4000-8000-000000000007','APPROVED','EMPLOYER');
INSERT INTO public."OrganizationCapability"(id,"organizationId",capability,status) VALUES
 ('cap-verifier','org-verifier','VERIFY_CREDENTIALS','APPROVED'),
 ('cap-expired','org-expired-verifier','VERIFY_CREDENTIALS','APPROVED');
INSERT INTO public."InstitutionICTStaff"(id,"organizationId","userId",status,permissions) VALUES
 ('staff-active','org-institution','40000000-0000-4000-8000-000000000004','ACTIVE',ARRAY['documents:download']),
 ('staff-inactive','org-institution','70000000-0000-4000-8000-000000000007','INACTIVE',ARRAY['documents:download']);

INSERT INTO public."Certificate"(id,"organizationId","graduateId") VALUES
 ('cert-institution','org-institution','30000000-0000-4000-8000-000000000003'),
 ('cert-employer','org-employer-issuer',NULL),
 ('cert-expired','org-institution',NULL);
INSERT INTO public."CertificateDocument"(id,"certificateId","organizationId","storagePath","scanStatus") VALUES
 ('doc-institution','cert-institution','org-institution','org-institution/cert-institution/file.pdf','NOT_SCANNED'),
 ('doc-employer','cert-employer','org-employer-issuer','org-employer-issuer/cert-employer/file.pdf','NOT_SCANNED'),
 ('doc-expired','cert-expired','org-institution','org-institution/cert-expired/file.pdf','NOT_SCANNED');
INSERT INTO public."CertificateAccessGrant"(id,"certificateId","organizationId",status,"expiresAt") VALUES
 ('grant-approved','cert-institution','org-verifier','APPROVED',now()+interval '1 day'),
 ('grant-expired','cert-expired','org-expired-verifier','APPROVED',now()-interval '1 day');
INSERT INTO storage.objects(bucket_id,name) VALUES
 ('verity-certificates','org-institution/cert-institution/file.pdf'),
 ('verity-certificates','org-employer-issuer/cert-employer/file.pdf'),
 ('verity-certificates','org-institution/cert-expired/file.pdf');
