-- Keep certificate uploads tenant-bound to the object path.
drop policy if exists "verity_private_certificate_upload" on storage.objects;

create policy "verity_private_certificate_upload"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'verity-certificates'
  and exists (
    select 1
    from public."Organization" o
    join public."Certificate" c on c."organizationId" = o.id
    where o.id = (storage.foldername(objects.name))[1]
      and c.id = (storage.foldername(objects.name))[2]
      and o."ownerId" = (select auth.uid()::text)
      and o.status = 'APPROVED'
      and private.verity_organization_has_capability(o.id, 'ISSUE_CREDENTIALS')
  )
);
