begin;

-- Certificate readers may inspect document metadata, but this does not grant
-- permission to read the private storage object. The storage policy below
-- remains independently restricted to documents:download.
drop policy if exists verity_document_read_scoped on public."CertificateDocument";
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
      and c.id = "CertificateDocument"."certificateId"
      and c."organizationId" = o.id
      and o."ownerId" = auth.uid()::text
      and o.status = 'APPROVED'
      and o.type = 'INSTITUTION'
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
