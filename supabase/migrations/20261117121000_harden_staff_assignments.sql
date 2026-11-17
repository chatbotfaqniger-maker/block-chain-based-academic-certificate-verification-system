-- Verity organization-staff tenant isolation and supported-permission hardening.
-- Staff assignments are limited to graduate accounts and two implemented permissions.
-- Active access is revoked automatically when an assignment or its organization is suspended.

create or replace function private.is_verity_graduate(p_user_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = 'off'
as $function$
  select exists (
    select 1
    from public."User" u
    where u.id = p_user_id
      and u.role = 'GRADUATE'::public."Role"
  );
$function$;

revoke all on function private.is_verity_graduate(text) from public;
grant usage on schema private to authenticated;
grant execute on function private.is_verity_graduate(text) to authenticated;

create or replace function private.is_active_org_staff(
  p_organization_id text,
  p_permission text default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = 'off'
as $function$
  select exists (
    select 1
    from public."OrganizationStaff" s
    join public."Organization" o on o.id = s."organizationId"
    join public."User" u on u.id = s."userId"
    where s."organizationId" = p_organization_id
      and s."userId" = auth.uid()::text
      and s.status = 'ACTIVE'
      and o.status = 'APPROVED'
      and u.role = 'GRADUATE'::public."Role"
      and (
        p_permission is null
        or s.permissions @> array[p_permission]::text[]
      )
  );
$function$;

revoke all on function private.is_active_org_staff(text, text) from public;
grant execute on function private.is_active_org_staff(text, text) to authenticated;

drop policy if exists verity_staff_owner_insert on public."OrganizationStaff";
create policy verity_staff_owner_insert
on public."OrganizationStaff"
for insert
to authenticated
with check (
  "createdBy" = auth.uid()::text
  and "userId" <> auth.uid()::text
  and status = 'ACTIVE'
  and private.is_verity_graduate("userId")
  and exists (
    select 1
    from public."Organization" o
    where o.id = "OrganizationStaff"."organizationId"
      and o."ownerId" = auth.uid()::text
      and o.status = 'APPROVED'
  )
);

drop policy if exists verity_staff_owner_update on public."OrganizationStaff";
create policy verity_staff_owner_update
on public."OrganizationStaff"
for update
to authenticated
using (
  exists (
    select 1
    from public."Organization" o
    where o.id = "OrganizationStaff"."organizationId"
      and o."ownerId" = auth.uid()::text
      and o.status = 'APPROVED'
  )
)
with check (
  private.is_verity_graduate("userId")
  and exists (
    select 1
    from public."Organization" o
    where o.id = "OrganizationStaff"."organizationId"
      and o."ownerId" = auth.uid()::text
      and o.status = 'APPROVED'
  )
);

create or replace function private.protect_org_staff_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = 'off'
as $function$
begin
  if not (select private.is_admin()) then
    if new.id is distinct from old.id
      or new."organizationId" is distinct from old."organizationId"
      or new."userId" is distinct from old."userId"
      or new."createdBy" is distinct from old."createdBy"
    then
      raise exception 'Organization staff assignment identity cannot be changed';
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function private.protect_org_staff_identity() from public;

drop trigger if exists verity_staff_protect_identity on public."OrganizationStaff";
create trigger verity_staff_protect_identity
before update on public."OrganizationStaff"
for each row
execute function private.protect_org_staff_identity();

-- Bind a document's metadata organization and certificate to its storage path.
-- The staff branch requires documents:download; certificate-read alone never
-- grants access to the private object bytes.
drop policy if exists verity_private_certificate_read on storage.objects;
create policy verity_private_certificate_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'verity-certificates'
  and exists (
    select 1
    from public."CertificateDocument" d
    where d."storagePath" = objects.name
      and d."scanStatus" = 'CLEAN'
      and d."organizationId" = (storage.foldername(objects.name))[1]
      and d."certificateId" = (storage.foldername(objects.name))[2]
      and (
        (select private.is_admin())
        or exists (
          select 1
          from public."Organization" o
          where o.id = (storage.foldername(objects.name))[1]
            and o."ownerId" = auth.uid()::text
            and o.status = 'APPROVED'
            and o.type = 'INSTITUTION'
        )
        or exists (
          select 1
          from public."Certificate" c
          where c.id = (storage.foldername(objects.name))[2]
            and c."graduateId" = auth.uid()::text
            and c."organizationId" = (storage.foldername(objects.name))[1]
        )
        or private.is_active_org_staff(
          (storage.foldername(objects.name))[1],
          'documents:download'
        )
      )
  )
);
