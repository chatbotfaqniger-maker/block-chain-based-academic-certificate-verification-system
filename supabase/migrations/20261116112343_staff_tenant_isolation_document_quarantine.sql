-- Verity staff tenant isolation and certificate-document quarantine hardening.
-- Staff permissions remain limited to certificates:read and documents:download.
-- Document storage is readable only after an explicit CLEAN scan result.

create or replace function private.is_active_org_staff(
  p_organization_id text,
  p_permission text default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public."OrganizationStaff" s
    join public."Organization" o on o.id = s."organizationId"
    where s."organizationId" = p_organization_id
      and s."userId" = auth.uid()::text
      and s.status = 'ACTIVE'
      and o.status = 'APPROVED'
      and (
        p_permission is null
        or s.permissions @> array[p_permission]::text[]
      )
  );
$function$;

revoke all on function private.is_active_org_staff(text, text) from public;
grant usage on schema private to authenticated;
grant execute on function private.is_active_org_staff(text, text) to authenticated;

alter table public."OrganizationStaff"
  drop constraint if exists "OrganizationStaff_permissions_allowed_check";

alter table public."OrganizationStaff"
  add constraint "OrganizationStaff_permissions_allowed_check"
  check (
    cardinality("permissions") between 1 and 2
    and array_position("permissions", null::text) is null
    and "permissions" <@ array['certificates:read', 'documents:download']::text[]
    and (
      not ('documents:download' = any("permissions"))
      or 'certificates:read' = any("permissions")
    )
  );

drop policy if exists verity_org_select on public."Organization";
create policy verity_org_select
on public."Organization"
for select
to authenticated
using (
  "ownerId" = auth.uid()::text
  or (select private.is_admin())
  or (
    status = 'APPROVED'
    and private.is_active_org_staff(id, 'certificates:read')
  )
);

drop policy if exists verity_certificate_staff_read on public."Certificate";
create policy verity_certificate_staff_read
on public."Certificate"
for select
to authenticated
using (
  private.is_active_org_staff("organizationId", 'certificates:read')
);

drop policy if exists verity_document_staff_read on public."CertificateDocument";
create policy verity_document_staff_read
on public."CertificateDocument"
for select
to authenticated
using (
  private.is_active_org_staff("organizationId", 'certificates:read')
);

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
