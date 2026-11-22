-- Minimal Supabase-compatible schema fixture for executing the VERITY queue migration.
-- This is an isolated CI database, not a copy of production data or its full schema.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create schema if not exists private;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create or replace function private.is_admin() returns boolean language sql stable as $$ select false $$;
create table public."User" (id text primary key);
create table public."Organization" (
  id text primary key,
  "ownerId" text not null references public."User"(id),
  type text not null,
  status text not null
);
