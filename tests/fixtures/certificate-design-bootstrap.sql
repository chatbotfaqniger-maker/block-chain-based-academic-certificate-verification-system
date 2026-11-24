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
  type text not null,
  status text not null
);
CREATE TABLE public."Certificate"(
  id text primary key,
  "certificateId" text not null unique
);
GRANT SELECT ON public."Organization" TO authenticated,service_role;
GRANT SELECT ON public."User" TO service_role;
GRANT ALL ON public."Certificate" TO service_role;
GRANT ALL ON public."User" TO service_role;
