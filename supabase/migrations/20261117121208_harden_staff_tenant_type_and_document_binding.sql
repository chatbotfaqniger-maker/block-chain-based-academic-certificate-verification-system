-- Tighten Verity staff tenancy and document-to-certificate ownership.
-- Staff assignments are institution-only. Staff access is live only while both
-- the assignment and its institution remain active/approved.
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
      and o.type = 'INSTITUTION'
      and u.role = 'GRADUATE'::public."Role"
      and (
        p_permission is null
        or (
          p_permission in ('certificates:read', 'documents:download')
          and s.permissions @> array[p_permission]::text[]
          and (
            p_permission <> 'documents:download'
            or s.permissions @> array['certificates:read']::text[]
          )
        )
      )
  );
$function$;

revoke all on function private.is_active_org_staff(text, text) from public;
grant usage on schema private to authenticated;
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
      and o.type = 'INSTITUTION'
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
      and o.type = 'INSTITUTION'
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
      and o.type = 'INSTITUTION'
  )
);

-- Keep document metadata inside the same institution/certificate tenant.
create or replace function private.enforce_certificate_document_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = 'off'
as $function$
declare
  v_organization_id text;
begin
  select c."organizationId"
    into v_organization_id
  from public."Certificate" c
  where c.id = new."certificateId";

  if not found or v_organization_id is distinct from new."organizationId" then
    raise exception 'Certificate document organization must match its certificate organization';
  end if;

  return new;
end;
$function$;

revoke all on function private.enforce_certificate_document_tenant() from public;

drop trigger if exists verity_certificate_document_tenant on public."CertificateDocument";
create trigger verity_certificate_document_tenant
before insert or update of "certificateId", "organizationId"
on public."CertificateDocument"
for each row
execute function private.enforce_certificate_document_tenant();

-- Replace the broad metadata policies with tenant-consistent checks.
drop policy if exists verity_document_read_scoped on public."CertificateDocument";
drop policy if exists verity_document_staff_read on public."CertificateDocument";
create policy verity_document_read_scoped
on public."CertificateDocument"
for select
to authenticated
using (
  (select private.is_admin())
  or exists (
    select 1
    from public."Organization" o
    join public."Certificate" c on c.id = "CertificateDocument"."certificateId"
    where o.id = "CertificateDocument"."organizationId"
      and o."ownerId" = auth.uid()::text
      and o.status = 'APPROVED'
      and o.type = 'INSTITUTION'
      and c."organizationId" = o.id
  )
  or exists (
    select 1
    from public."Certificate" c
    where c.id = "CertificateDocument"."certificateId"
      and c."organizationId" = "CertificateDocument"."organizationId"
      and c."graduateId" = auth.uid()::text
  )
  or (
    private.is_active_org_staff("CertificateDocument"."organizationId", 'certificates:read')
    and exists (
      select 1
      from public."Certificate" c
      where c.id = "CertificateDocument"."certificateId"
        and c."organizationId" = "CertificateDocument"."organizationId"
    )
  )
);

drop policy if exists verity_document_granted_verifier_read on public."CertificateDocument";
create policy verity_document_granted_verifier_read
on public."CertificateDocument"
for select
to authenticated
using (
  exists (
    select 1
    from public."CertificateAccessGrant" g
    join public."Organization" o on o.id = g."organizationId"
    join public."Certificate" c on c.id = "CertificateDocument"."certificateId"
    where g."certificateId" = "CertificateDocument"."certificateId"
      and c."organizationId" = "CertificateDocument"."organizationId"
      and g.status = 'APPROVED'
      and (g."expiresAt" is null or g."expiresAt" > now())
      and o."ownerId" = auth.uid()::text
      and o.type = 'EMPLOYER'
      and o.status = 'APPROVED'
  )
);

-- A staff member can only read clean storage objects whose path, document
-- metadata and certificate all resolve to the same institution.
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
    join public."Certificate" c
      on c.id = d."certificateId"
     and c."organizationId" = d."organizationId"
    where d."storagePath" = objects.name
      and d."scanStatus" = 'CLEAN'
      and d."organizationId" = (storage.foldername(objects.name))[1]
      and d."certificateId" = (storage.foldername(objects.name))[2]
      and (
        (select private.is_admin())
        or exists (
          select 1
          from public."Organization" o
          where o.id = d."organizationId"
            and o."ownerId" = auth.uid()::text
            and o.status = 'APPROVED'
            and o.type = 'INSTITUTION'
        )
        or c."graduateId" = auth.uid()::text
        or private.is_active_org_staff(
          d."organizationId",
          'documents:download'
        )
      )
  )
);

drop policy if exists verity_storage_granted_verifier_read on storage.objects;
create policy verity_storage_granted_verifier_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'verity-certificates'
  and exists (
    select 1
    from public."CertificateDocument" d
    join public."Certificate" c
      on c.id = d."certificateId"
     and c."organizationId" = d."organizationId"
    join public."CertificateAccessGrant" g
      on g."certificateId" = d."certificateId"
    join public."Organization" o
      on o.id = g."organizationId"
    where d."storagePath" = objects.name
      and d."organizationId" = (storage.foldername(objects.name))[1]
      and d."certificateId" = (storage.foldername(objects.name))[2]
      and d."scanStatus" = 'CLEAN'
      and g.status = 'APPROVED'
      and (g."expiresAt" is null or g."expiresAt" > now())
      and o."ownerId" = auth.uid()::text
      and o.type = 'EMPLOYER'
      and o.status = 'APPROVED'
  )
);
