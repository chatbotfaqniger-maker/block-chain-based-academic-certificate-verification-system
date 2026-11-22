begin;

alter table public."Organization"
  add column if not exists "locationCity" text,
  add column if not exists "locationState" text,
  add column if not exists "locationCountry" text;

alter table public."Organization"
  drop constraint if exists organization_location_city_length_chk,
  add constraint organization_location_city_length_chk
    check ("locationCity" is null or char_length(btrim("locationCity")) between 2 and 100),
  drop constraint if exists organization_location_state_length_chk,
  add constraint organization_location_state_length_chk
    check ("locationState" is null or char_length(btrim("locationState")) between 2 and 100),
  drop constraint if exists organization_location_country_length_chk,
  add constraint organization_location_country_length_chk
    check ("locationCountry" is null or char_length(btrim("locationCountry")) between 2 and 100);

drop function if exists public.verity_public_organization_directory(text, text);

create function public.verity_public_organization_directory(
  p_search text default null,
  p_type text default 'ALL',
  p_location text default null
)
returns table(
  name text,
  type text,
  "registrationNumber" text,
  "officialWebsite" text,
  "officialEmailDomain" text,
  "accreditationBody" text,
  "verifiedAt" timestamptz,
  "locationCity" text,
  "locationState" text,
  "locationCountry" text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select
    o.name,
    o.type,
    o."registrationNumber",
    o."officialWebsite",
    o."officialEmailDomain",
    o."accreditationBody",
    o."verifiedAt",
    o."locationCity",
    o."locationState",
    o."locationCountry"
  from public."Organization" o
  where o.status = 'APPROVED'
    and o."directoryVisible" is true
    and (upper(coalesce(p_type, 'ALL')) = 'ALL' or o.type = upper(p_type))
    and (
      nullif(btrim(p_search), '') is null
      or o.name ilike '%' || replace(replace(left(btrim(p_search), 100), '%', ' '), '_', ' ') || '%'
    )
    and (
      nullif(btrim(p_location), '') is null
      or concat_ws(' ', o."locationCity", o."locationState", o."locationCountry")
        ilike '%' || replace(replace(left(btrim(p_location), 100), '%', ' '), '_', ' ') || '%'
    )
  order by o.name
  limit 200;
$function$;

revoke all on function public.verity_public_organization_directory(text, text, text) from public;
grant execute on function public.verity_public_organization_directory(text, text, text) to anon, authenticated;

commit;
