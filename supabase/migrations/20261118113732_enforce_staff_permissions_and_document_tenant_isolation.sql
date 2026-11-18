begin;

update public."OrganizationStaff"
set permissions = array(
  select p from unnest(coalesce(permissions, array[]::text[])) p
  where p in ('certificates:read','documents:download')
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='organization_staff_supported_permissions_chk'
  ) then
    alter table public."OrganizationStaff"
      add constraint organization_staff_supported_permissions_chk
      check (
        coalesce(permissions, array[]::text[]) <@ array['certificates:read','documents:download']::text[]
        and (
          not (coalesce(permissions, array[]::text[]) @> array['documents:download']::text[])
          or coalesce(permissions, array[]::text[]) @> array['certificates:read']::text[]
        )
      );
  end if;
end $$;

drop policy if exists verity_staff_owner_insert on public."OrganizationStaff";
create policy verity_staff_owner_insert
on public."OrganizationStaff"
for insert to authenticated
with check (
  "createdBy" = auth.uid()::text
  and "userId" <> auth.uid()::text
  and status in ('ACTIVE','SUSPENDED')
  and private.is_verity_graduate("userId")
  and coalesce(permissions, array[]::text[]) <@ array['certificates:read','documents:download']::text[]
  and (
    not (coalesce(permissions, array[]::text[]) @> array['documents:download']::text[])
    or coalesce(permissions, array[]::text[]) @> array['certificates:read']::text[]
  )
  and exists (
    select 1 from public."Organization" o
    where o.id = "OrganizationStaff"."organizationId"
      and o."ownerId" = auth.uid()::text
      and o.status = 'APPROVED'
      and o.type = 'INSTITUTION'
  )
);

drop policy if exists verity_staff_owner_update on public."OrganizationStaff";
create policy verity_staff_owner_update
on public."OrganizationStaff"
for update to authenticated
using (
  exists (
    select 1 from public."Organization" o
    where o.id = "OrganizationStaff"."organizationId"
      and o."ownerId" = auth.uid()::text
      and o.status = 'APPROVED'
      and o.type = 'INSTITUTION'
  )
)
with check (
  private.is_verity_graduate("userId")
  and status in ('ACTIVE','SUSPENDED')
  and coalesce(permissions, array[]::text[]) <@ array['certificates:read','documents:download']::text[]
  and (
    not (coalesce(permissions, array[]::text[]) @> array['documents:download']::text[])
    or coalesce(permissions, array[]::text[]) @> array['certificates:read']::text[]
  )
  and exists (
    select 1 from public."Organization" o
    where o.id = "OrganizationStaff"."organizationId"
      and o."ownerId" = auth.uid()::text
      and o.status = 'APPROVED'
      and o.type = 'INSTITUTION'
  )
);

drop policy if exists verity_document_read_scoped on public."CertificateDocument";
create policy verity_document_read_scoped
on public."CertificateDocument"
for select to authenticated
using (
  (select private.is_admin())
  or exists (
    select 1
    from public."Organization" o
    join public."Certificate" c on c."organizationId" = o.id
    where o.id = "CertificateDocument"."organizationId"
      and c.id = "CertificateDocument"."certificateId"
      and o."ownerId" = auth.uid()::text
      and o.status = 'APPROVED'
      and o.type = 'INSTITUTION'
  )
  or exists (
    select 1
    from public."Certificate" c
    where c.id = "CertificateDocument"."certificateId"
      and c."graduateId" = auth.uid()::text
  )
  or (
    private.is_active_org_staff("CertificateDocument"."organizationId",'documents:download')
    and exists (
      select 1
      from public."Certificate" c
      where c.id = "CertificateDocument"."certificateId"
        and c."organizationId" = "CertificateDocument"."organizationId"
    )
  )
  or exists (
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

commit;