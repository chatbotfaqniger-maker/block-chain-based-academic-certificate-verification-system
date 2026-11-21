-- VERITY document access policy update.
-- Antivirus scanning is intentionally not part of this product. Keep private-bucket,
-- tenant, ownership, staff-permission and graduate-consent checks; do not gate on scanStatus.
begin;

drop policy if exists verity_private_certificate_read on storage.objects;
create policy verity_private_certificate_read
on storage.objects
for select to authenticated
using (
  bucket_id = 'verity-certificates'
  and exists (
    select 1
    from public."CertificateDocument" d
    join public."Certificate" c
      on c.id = d."certificateId"
     and c."organizationId" = d."organizationId"
    where d."storagePath" = objects.name
      and d."organizationId" = (storage.foldername(objects.name))[1]
      and d."certificateId" = (storage.foldername(objects.name))[2]
      and (
        (select private.is_admin())
        or exists (
          select 1 from public."Organization" o
          where o.id = d."organizationId"
            and o."ownerId" = auth.uid()::text
            and o.status = 'APPROVED'
            and o.type = 'INSTITUTION'
        )
        or c."graduateId" = auth.uid()::text
        or private.is_active_org_staff(d."organizationId", 'documents:download')
      )
  )
);

drop policy if exists verity_storage_granted_verifier_read on storage.objects;
create policy verity_storage_granted_verifier_read
on storage.objects
for select to authenticated
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
      and g.status = 'APPROVED'
      and (g."expiresAt" is null or g."expiresAt" > now())
      and o."ownerId" = auth.uid()::text
      and o.type = 'EMPLOYER'
      and o.status = 'APPROVED'
  )
);

commit;
