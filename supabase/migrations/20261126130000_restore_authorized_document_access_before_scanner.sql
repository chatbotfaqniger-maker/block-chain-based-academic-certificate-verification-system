-- VERITY launch policy: malware scanning is a planned future capability, not a launch prerequisite.
-- Keep certificate objects in private storage and enforce issuer, graduate, staff and
-- approved-verifier authorization. Do not claim that an unscanned document is CLEAN.
-- SHA-256 integrity verification remains mandatory in the application download/preview paths.
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

commit;
