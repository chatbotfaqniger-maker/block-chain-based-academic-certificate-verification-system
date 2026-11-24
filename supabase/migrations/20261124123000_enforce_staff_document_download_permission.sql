-- Staff certificate-document reads require the explicit documents:download permission.
-- The documents:download permission is only valid together with certificates:read,
-- enforced by private.is_active_org_staff and OrganizationStaff RLS checks.

drop policy if exists "verity_document_read_scoped" on public."CertificateDocument";

create policy "verity_document_read_scoped"
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
      and c.id = "CertificateDocument"."certificateId"
      and c."organizationId" = o.id
      and o."ownerId" = (select auth.uid())::text
      and o.status = 'APPROVED'
      and o.type = 'INSTITUTION'
  )
  or exists (
    select 1
    from public."Certificate" c
    where c.id = "CertificateDocument"."certificateId"
      and c."organizationId" = "CertificateDocument"."organizationId"
      and c."graduateId" = (select auth.uid())::text
  )
  or (
    private.is_active_org_staff("organizationId", 'documents:download')
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
      and g."expiresAt" > now()
      and c.status = 'ACTIVE'::"CertificateStatus"
      and o."ownerId" = (select auth.uid())::text
      and o.type = 'EMPLOYER'
      and o.status = 'APPROVED'
  )
);
