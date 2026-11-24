CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER ROLE service_role BYPASSRLS;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS private;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
CREATE OR REPLACE FUNCTION private.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
GRANT USAGE ON SCHEMA public,auth,private TO anon,authenticated,service_role;
CREATE TABLE public."User"(id text primary key);
CREATE TABLE public."Organization"(
  id text primary key,
  "ownerId" text not null references public."User"(id),
  name text not null default 'Institution A',
  type text not null,
  status text not null
);
CREATE TABLE public."Certificate"(
  id text primary key,
  "certificateId" text not null unique,
  "verificationKey" text not null unique,
  "studentName" text not null,
  "studentEmail" text,
  "studentNumber" text not null,
  institution text not null,
  faculty text not null,
  department text not null,
  programme text not null,
  qualification text not null,
  classification text,
  "awardDate" timestamptz not null,
  "issuedAt" timestamptz not null,
  digest text not null unique,
  "txHash" text,
  "chainId" integer,
  "contractAddress" text,
  status text not null,
  "revokedAt" timestamptz,
  "revokeReason" text,
  "graduateId" text references public."User"(id),
  "issuerId" text not null references public."User"(id),
  "organizationId" text not null references public."Organization"(id),
  "createdAt" timestamptz not null,
  "updatedAt" timestamptz not null
);
CREATE TABLE public."CertificateLedger"(
  id bigserial primary key,
  "certificateId" text not null,
  event text not null,
  created_at timestamptz not null default now()
);
CREATE OR REPLACE FUNCTION public.test_append_certificate_ledger()
RETURNS trigger LANGUAGE plpgsql AS $
BEGIN
  INSERT INTO public."CertificateLedger"("certificateId",event) VALUES (NEW."certificateId",'ISSUED');
  RETURN NEW;
END;
$;
CREATE TRIGGER test_certificate_ledger_after_insert
AFTER INSERT ON public."Certificate"
FOR EACH ROW EXECUTE FUNCTION public.test_append_certificate_ledger();
GRANT SELECT ON public."Organization" TO authenticated,service_role;
GRANT SELECT ON public."User" TO service_role;
GRANT ALL ON public."Certificate" TO service_role;
GRANT ALL ON public."User" TO service_role;
