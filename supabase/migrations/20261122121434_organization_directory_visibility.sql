begin;

alter table public."Organization"
  add column if not exists "directoryVisible" boolean not null default true;

comment on column public."Organization"."directoryVisible"
  is 'Controls inclusion in the public VERITY Global Directory only; it does not affect approval, registration, certificate issuance, or certificate verification.';

create or replace function public.verity_public_organization_directory(
  p_search text default null,
  p_type text default 'ALL'
)
returns table(
  name text,
  type text,
  "registrationNumber" text,
  "officialWebsite" text,
  "officialEmailDomain" text,
  "accreditationBody" text,
  "verifiedAt" timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select o.name, o.type, o."registrationNumber", o."officialWebsite",
         o."officialEmailDomain", o."accreditationBody", o."verifiedAt"
  from public."Organization" o
  where o.status = 'APPROVED'
    and o."directoryVisible" is true
    and (upper(coalesce(p_type, 'ALL')) = 'ALL' or o.type = upper(p_type))
    and (
      nullif(btrim(p_search), '') is null
      or o.name ilike '%' || replace(replace(left(btrim(p_search), 100), '%', ' '), '_', ' ') || '%'
    )
  order by o.name
  limit 200;
$function$;

create or replace function public.set_verity_organization_directory_visibility(p_visible boolean)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_organization_id text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to change directory visibility.'
      using errcode = '42501';
  end if;

  update public."Organization"
     set "directoryVisible" = p_visible,
         "updatedAt" = now()
   where "ownerId" = auth.uid()::text
     and status = 'APPROVED'
  returning id into v_organization_id;

  if v_organization_id is null then
    raise exception 'Only the owner of an approved organization can change directory visibility.'
      using errcode = '42501';
  end if;

  return p_visible;
end;
$function$;

revoke all on function public.set_verity_organization_directory_visibility(boolean) from public;
revoke all on function public.set_verity_organization_directory_visibility(boolean) from anon;
grant execute on function public.set_verity_organization_directory_visibility(boolean) to authenticated;

commit;
