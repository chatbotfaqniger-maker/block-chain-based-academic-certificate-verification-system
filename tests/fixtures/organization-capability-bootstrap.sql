-- Minimal PostgreSQL fixture for the additive organization capability foundation.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER ROLE service_role BYPASSRLS;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS private;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
CREATE OR REPLACE FUNCTION private.is_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT false $$;
GRANT USAGE ON SCHEMA public,auth,private TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.is_admin() TO authenticated,service_role;

CREATE TABLE public."User" (
  id text PRIMARY KEY
);
CREATE TABLE public."Organization" (
  id text PRIMARY KEY,
  "ownerId" text NOT NULL REFERENCES public."User"(id),
  name text NOT NULL,
  type text NOT NULL CHECK(type IN ('INSTITUTION','EMPLOYER')),
  status text NOT NULL CHECK(status IN ('PENDING','APPROVED','SUSPENDED')),
  "educationLevels" text[] NOT NULL DEFAULT ARRAY[]::text[]
);
CREATE TABLE public."InstitutionICTStaff" (
  id text PRIMARY KEY,
  "organizationId" text NOT NULL REFERENCES public."Organization"(id),
  "userId" text NOT NULL REFERENCES public."User"(id),
  permissions text[] NOT NULL DEFAULT ARRAY[]::text[],
  status text NOT NULL
);
GRANT SELECT ON public."Organization" TO authenticated,service_role;
GRANT SELECT ON public."User" TO authenticated,service_role;
GRANT SELECT ON public."InstitutionICTStaff" TO authenticated,service_role;

INSERT INTO public."User"(id) VALUES
 ('user-inst-approved'),('user-inst-suspended'),('user-inst-pending'),
 ('user-org-approved'),('user-org-suspended'),('user-org-pending');

INSERT INTO public."Organization"(id,"ownerId",name,type,status) VALUES
 ('org-inst-approved','user-inst-approved','Approved University','INSTITUTION','APPROVED'),
 ('org-inst-suspended','user-inst-suspended','Suspended University','INSTITUTION','SUSPENDED'),
 ('org-inst-pending','user-inst-pending','Pending School','INSTITUTION','PENDING'),
 ('org-org-approved','user-org-approved','Approved Verifier','EMPLOYER','APPROVED'),
 ('org-org-suspended','user-org-suspended','Suspended Verifier','EMPLOYER','SUSPENDED'),
 ('org-org-pending','user-org-pending','Pending Organization','EMPLOYER','PENDING');
