-- Cache stable auth identity lookups once per statement in RLS predicates.
drop policy if exists verity_org_select on public."Organization";
create policy verity_org_select on public."Organization"
for select to authenticated
using (
  "ownerId" = (select auth.uid())::text
  or (select private.is_admin())
  or (status = 'APPROVED' and private.is_active_org_staff(id, 'certificates:read'))
);

drop policy if exists verity_document_granted_verifier_read on public."CertificateDocument";
create policy verity_document_granted_verifier_read on public."CertificateDocument"
for select to authenticated
using (
  exists (
    select 1 from public."CertificateAccessGrant" g
    join public."Organization" o on o.id = g."organizationId"
    join public."Certificate" c on c.id = "CertificateDocument"."certificateId"
    where g."certificateId" = "CertificateDocument"."certificateId"
      and c."organizationId" = "CertificateDocument"."organizationId"
      and g.status = 'APPROVED'
      and (g."expiresAt" is null or g."expiresAt" > now())
      and o."ownerId" = (select auth.uid())::text
      and o.type = 'EMPLOYER' and o.status = 'APPROVED'
  )
);

drop policy if exists verity_staff_owner_insert on public."OrganizationStaff";
create policy verity_staff_owner_insert on public."OrganizationStaff"
for insert to authenticated
with check (
  "createdBy" = (select auth.uid())::text
  and "userId" <> (select auth.uid())::text
  and status in ('ACTIVE','SUSPENDED')
  and private.is_verity_graduate("userId")
  and coalesce(permissions, array[]::text[]) <@ array['certificates:read','documents:download']::text[]
  and (not (coalesce(permissions, array[]::text[]) @> array['documents:download']::text[])
       or coalesce(permissions, array[]::text[]) @> array['certificates:read']::text[])
  and exists (
    select 1 from public."Organization" o
    where o.id = "OrganizationStaff"."organizationId"
      and o."ownerId" = (select auth.uid())::text
      and o.status = 'APPROVED' and o.type = 'INSTITUTION'
  )
);

drop policy if exists verity_staff_owner_update on public."OrganizationStaff";
create policy verity_staff_owner_update on public."OrganizationStaff"
for update to authenticated
using (
  exists (
    select 1 from public."Organization" o
    where o.id = "OrganizationStaff"."organizationId"
      and o."ownerId" = (select auth.uid())::text
      and o.status = 'APPROVED' and o.type = 'INSTITUTION'
  )
)
with check (
  private.is_verity_graduate("userId")
  and status in ('ACTIVE','SUSPENDED')
  and coalesce(permissions, array[]::text[]) <@ array['certificates:read','documents:download']::text[]
  and (not (coalesce(permissions, array[]::text[]) @> array['documents:download']::text[])
       or coalesce(permissions, array[]::text[]) @> array['certificates:read']::text[])
  and exists (
    select 1 from public."Organization" o
    where o.id = "OrganizationStaff"."organizationId"
      and o."ownerId" = (select auth.uid())::text
      and o.status = 'APPROVED' and o.type = 'INSTITUTION'
  )
);

create index if not exists "CertificateDocument_uploadedBy_idx"
  on public."CertificateDocument" ("uploadedBy");
create index if not exists "OrganizationStaff_createdBy_idx"
  on public."OrganizationStaff" ("createdBy");
