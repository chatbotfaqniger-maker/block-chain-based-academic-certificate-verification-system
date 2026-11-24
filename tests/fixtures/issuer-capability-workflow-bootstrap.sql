-- PostgreSQL schema fixture for the capability-aware issuer workflow migration.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER ROLE service_role BYPASSRLS;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS private;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TYPE public."Role" AS ENUM ('ADMIN','EMPLOYER','GRADUATE');
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE OR REPLACE FUNCTION private.is_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION private.is_active_org_staff(p_organization_id text,p_permission text)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION storage.foldername(p_name text)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array(p_name,'/') $$;
GRANT USAGE ON SCHEMA public,auth,private,storage TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.is_admin() TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.is_active_org_staff(text,text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION storage.foldername(text) TO authenticated,service_role;

CREATE TABLE public."User" (
 id text PRIMARY KEY,
 role public."Role" NOT NULL DEFAULT 'GRADUATE',
 "fullName" text NOT NULL DEFAULT 'Test User',
 email text
);
CREATE TABLE public."Organization" (
 id text PRIMARY KEY,
 "ownerId" text NOT NULL REFERENCES public."User"(id),
 name text NOT NULL,
 type text NOT NULL CHECK(type IN ('INSTITUTION','EMPLOYER')),
 status text NOT NULL CHECK(status IN ('PENDING','APPROVED','SUSPENDED')),
 "educationLevels" text[] NOT NULL DEFAULT ARRAY[]::text[],
 "registrationCode" text,
 "registrationCodeExpiryEnabled" boolean NOT NULL DEFAULT false,
 "registrationCodeExpiresAt" timestamptz,
 "directoryVisible" boolean NOT NULL DEFAULT true,
 "locationCity" text,
 "locationState" text,
 "locationCountry" text,
 "registrationNumber" text,
 "officialWebsite" text,
 "officialEmailDomain" text,
 "accreditationBody" text
);
CREATE TABLE public."InstitutionICTStaff" (
 id text PRIMARY KEY,
 "organizationId" text NOT NULL REFERENCES public."Organization"(id),
 "userId" text NOT NULL REFERENCES public."User"(id),
 permissions text[] NOT NULL DEFAULT ARRAY[]::text[],
 status text NOT NULL
);
CREATE TABLE public."StudentRoster" (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
 "organizationId" text NOT NULL REFERENCES public."Organization"(id),
 "studentNumber" text NOT NULL,
 "normalizedStudentNumber" text NOT NULL,
 "fullName" text NOT NULL,
 "institutionalEmail" text,
 faculty text,
 department text,
 programme text,
 "academicSession" text,
 status text NOT NULL DEFAULT 'ELIGIBLE',
 "claimedUserId" text REFERENCES public."User"(id),
 "claimedAt" timestamptz,
 "createdAt" timestamptz NOT NULL DEFAULT now(),
 "updatedAt" timestamptz NOT NULL DEFAULT now(),
 UNIQUE("organizationId","normalizedStudentNumber")
);
CREATE TABLE public."StudentRosterImport" (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
 "organizationId" text NOT NULL REFERENCES public."Organization"(id),
 "uploadedBy" text NOT NULL REFERENCES public."User"(id),
 "fileName" text NOT NULL DEFAULT 'roster.csv',
 "totalRows" integer NOT NULL DEFAULT 0,
 "rejectedRows" integer NOT NULL DEFAULT 0,
 "insertedRows" integer NOT NULL DEFAULT 0,
 "duplicateRows" integer NOT NULL DEFAULT 0,
 "totalChunks" integer NOT NULL DEFAULT 0,
 "processedChunks" integer NOT NULL DEFAULT 0,
 "failedChunks" integer NOT NULL DEFAULT 0,
 status text NOT NULL DEFAULT 'UPLOADING',
 "errorSummary" jsonb,
 "completedAt" timestamptz,
 "createdAt" timestamptz NOT NULL DEFAULT now(),
 "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public."StudentImportChunk" (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
 "batchId" text NOT NULL REFERENCES public."StudentRosterImport"(id),
 "organizationId" text NOT NULL REFERENCES public."Organization"(id),
 "createdBy" text NOT NULL REFERENCES public."User"(id),
 "chunkIndex" integer NOT NULL,
 rows jsonb NOT NULL DEFAULT '[]'::jsonb,
 status text NOT NULL DEFAULT 'PENDING',
 attempts integer NOT NULL DEFAULT 0,
 "errorMessage" text,
 "processedAt" timestamptz
);
CREATE TABLE public."StudentActivationToken" (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
 "rosterId" text NOT NULL REFERENCES public."StudentRoster"(id),
 "organizationId" text NOT NULL REFERENCES public."Organization"(id),
 "tokenHash" text NOT NULL,
 "usedAt" timestamptz,
 "usedBy" text,
 "revokedAt" timestamptz,
 "expiresAt" timestamptz
);
CREATE TABLE public."Membership" (
 id text PRIMARY KEY,
 "organizationId" text NOT NULL REFERENCES public."Organization"(id),
 "userId" text NOT NULL REFERENCES public."User"(id),
 "studentNumber" text,
 status text NOT NULL,
 "updatedAt" timestamptz NOT NULL DEFAULT now(),
 UNIQUE("organizationId","userId")
);
CREATE TABLE public."Certificate" (
 id text PRIMARY KEY,
 "certificateId" text NOT NULL UNIQUE,
 "verificationKey" text NOT NULL UNIQUE,
 "studentName" text NOT NULL,
 "studentEmail" text,
 "studentNumber" text NOT NULL,
 institution text NOT NULL,
 faculty text NOT NULL,
 department text NOT NULL,
 programme text NOT NULL,
 qualification text NOT NULL,
 classification text,
 "awardDate" timestamptz NOT NULL,
 "issuedAt" timestamptz NOT NULL,
 digest text NOT NULL,
 "txHash" text,
 "chainId" integer,
 "contractAddress" text,
 status text NOT NULL,
 "revokedAt" timestamptz,
 "revokeReason" text,
 "graduateId" text REFERENCES public."User"(id),
 "issuerId" text NOT NULL REFERENCES public."User"(id),
 "organizationId" text NOT NULL REFERENCES public."Organization"(id),
 "createdAt" timestamptz NOT NULL DEFAULT now(),
 "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public."CertificateDocument" (
 id text PRIMARY KEY,
 "organizationId" text NOT NULL REFERENCES public."Organization"(id),
 "certificateId" text NOT NULL REFERENCES public."Certificate"(id),
 "uploadedBy" text NOT NULL REFERENCES public."User"(id),
 "storagePath" text NOT NULL
);
CREATE TABLE public."CertificateAccessGrant" (
 id text PRIMARY KEY,
 "organizationId" text NOT NULL REFERENCES public."Organization"(id),
 "certificateId" text NOT NULL REFERENCES public."Certificate"(id),
 "graduateId" text NOT NULL REFERENCES public."User"(id),
 "requestedBy" text NOT NULL REFERENCES public."User"(id),
 status text NOT NULL,
 "expiresAt" timestamptz NOT NULL
);
CREATE TABLE public."CertificateIssuanceBatch" (
 id text PRIMARY KEY,
 "organizationId" text NOT NULL REFERENCES public."Organization"(id),
 "createdBy" text NOT NULL REFERENCES public."User"(id),
 status text NOT NULL,
 "totalItems" integer NOT NULL CHECK("totalItems" BETWEEN 1 AND 500)
);
CREATE TABLE public."CertificateIssuanceItem" (
 id text PRIMARY KEY,
 "organizationId" text NOT NULL REFERENCES public."Organization"(id),
 "batchId" text NOT NULL REFERENCES public."CertificateIssuanceBatch"(id)
);
CREATE TABLE public."Verification" (
 id text PRIMARY KEY,
 "certificateId" text NOT NULL REFERENCES public."Certificate"(id),
 "verifierName" text,
 "verifierOrg" text,
 result text,
 "createdAt" timestamptz NOT NULL DEFAULT now(),
 "organizationId" text REFERENCES public."Organization"(id)
);
CREATE TABLE storage.objects (
 id bigserial PRIMARY KEY,
 bucket_id text NOT NULL,
 name text NOT NULL
);

INSERT INTO public."User"(id,role,"fullName",email) VALUES
 ('user-inst-approved','EMPLOYER','Approved University Owner','inst-approved@example.test'),
 ('user-inst-suspended','EMPLOYER','Suspended University Owner','inst-suspended@example.test'),
 ('user-inst-pending','EMPLOYER','Pending School Owner','inst-pending@example.test'),
 ('user-org-approved','EMPLOYER','Approved Verifier Owner','org-approved@example.test'),
 ('user-org-suspended','EMPLOYER','Suspended Verifier Owner','org-suspended@example.test'),
 ('user-org-pending','EMPLOYER','Pending Organization Owner','org-pending@example.test'),
 ('user-grad','GRADUATE','Test Graduate','graduate@example.test');

INSERT INTO public."Organization"(id,"ownerId",name,type,status,"registrationCode") VALUES
 ('org-inst-approved','user-inst-approved','Approved University','INSTITUTION','APPROVED','VRT-APPROVED'),
 ('org-inst-suspended','user-inst-suspended','Suspended University','INSTITUTION','SUSPENDED','VRT-SUSPENDED'),
 ('org-inst-pending','user-inst-pending','Pending School','INSTITUTION','PENDING','VRT-PENDING'),
 ('org-org-approved','user-org-approved','Approved Verifier','EMPLOYER','APPROVED','VRT-VERIFIER'),
 ('org-org-suspended','user-org-suspended','Suspended Verifier','EMPLOYER','SUSPENDED','VRT-VERIFIER-SUSPENDED'),
 ('org-org-pending','user-org-pending','Pending Organization','EMPLOYER','PENDING','VRT-ORG-PENDING');


ALTER TABLE public."StudentRoster" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."StudentRosterImport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."StudentImportChunk" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."StudentActivationToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Certificate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CertificateDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CertificateAccessGrant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CertificateIssuanceBatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CertificateIssuanceItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated,service_role;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated,service_role;
