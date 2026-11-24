CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE supabase_admin NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TYPE public."CertificateStatus" AS ENUM ('ACTIVE','REVOKED');
CREATE TABLE public."Certificate" (
  id text PRIMARY KEY,
  "certificateId" text NOT NULL UNIQUE,
  "verificationKey" text NOT NULL,
  "studentName" text NOT NULL,
  "studentNumber" text NOT NULL,
  "studentEmail" text,
  institution text NOT NULL,
  faculty text NOT NULL,
  department text NOT NULL,
  programme text NOT NULL,
  qualification text NOT NULL,
  classification text,
  "awardDate" timestamp without time zone NOT NULL,
  "issuedAt" timestamp without time zone NOT NULL,
  digest text NOT NULL,
  "txHash" text,
  "chainId" integer,
  "contractAddress" text,
  status public."CertificateStatus" NOT NULL DEFAULT 'ACTIVE',
  "revokedAt" timestamptz,
  "revokeReason" text,
  "graduateId" text,
  "issuerId" text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "organizationId" text NOT NULL,
  "bulkIssuanceItemId" text
);
CREATE TABLE public."CertificateLedger" (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "certificateId" text NOT NULL,
  "certificateCode" text NOT NULL,
  "eventType" text NOT NULL,
  "eventData" jsonb NOT NULL,
  "previousHash" text NOT NULL,
  "entryHash" text NOT NULL,
  "recordedAt" timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public."Certificate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CertificateLedger" ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.verify_verity_certificate_ledger(p_certificate_id text)
RETURNS TABLE(ledger_valid boolean,event_count bigint,latest_event text,head_hash text)
LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $$
  SELECT true,
    count(*)::bigint,
    (SELECT l."eventType" FROM public."CertificateLedger" l WHERE l."certificateCode"=p_certificate_id ORDER BY l.id DESC LIMIT 1),
    (SELECT l."entryHash" FROM public."CertificateLedger" l ORDER BY l.id DESC LIMIT 1)
  FROM public."CertificateLedger" l
  WHERE l."certificateCode"=p_certificate_id;
$$;
CREATE OR REPLACE FUNCTION public.lookup_verity_certificate(text,text,text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT '{}'::jsonb; $$;
CREATE OR REPLACE FUNCTION public.verity_student_registration_precheck(text,text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT false; $$;

-- Simulate the permissive Supabase default ACL that existed before hardening.
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
GRANT CREATE ON SCHEMA public TO supabase_admin;
