-- Graduate-controlled certificate access revocation and repeatable request history.
-- Additive change: preserves existing grant records and their original approval windows.

alter table public."CertificateAccessGrant"
  add column if not exists "revokedAt" timestamptz,
  add column if not exists "revokedBy" text;

-- Keep a single pending request per certificate / verifier, while retaining
-- rejected, revoked and expired approvals as immutable history.
create unique index if not exists "CertificateAccessGrant_one_pending_per_pair_idx"
  on public."CertificateAccessGrant" ("certificateId", "organizationId")
  where status = 'PENDING';

alter table public."CertificateAccessGrant"
  drop constraint if exists "CertificateAccessGrant_certificateId_organizationId_key";

drop policy if exists "verity_certificate_grant_student_update"
  on public."CertificateAccessGrant";

create policy "verity_certificate_grant_student_update"
  on public."CertificateAccessGrant"
  for update
  to authenticated
  using (
    "graduateId" = (select auth.uid())::text
    and status in ('PENDING', 'APPROVED')
  )
  with check (
    "graduateId" = (select auth.uid())::text
    and status in ('APPROVED', 'REJECTED', 'REVOKED')
  );

create or replace function private.guard_certificate_access_grant_update()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new."graduateId" is distinct from old."graduateId"
     or new."certificateId" is distinct from old."certificateId"
     or new."organizationId" is distinct from old."organizationId"
     or new."requestedBy" is distinct from old."requestedBy"
     or new.purpose is distinct from old.purpose
     or new."createdAt" is distinct from old."createdAt" then
    raise exception 'Certificate access request identity fields are immutable.';
  end if;

  if old.status = 'PENDING' and new.status in ('APPROVED', 'REJECTED') then
    if new.status = 'APPROVED' then
      if new."approvedAt" is null
         or new."expiresAt" is null
         or new."expiresAt" <= now()
         or new."expiresAt" > now() + interval '31 days' then
        raise exception 'Approval must have a valid expiry within 30 days.';
      end if;
      new."revokedAt" := null;
      new."revokedBy" := null;
    else
      new."approvedAt" := null;
      new."expiresAt" := null;
      new."revokedAt" := null;
      new."revokedBy" := null;
    end if;
  elsif old.status = 'APPROVED' and new.status = 'REVOKED' then
    if old."expiresAt" is null or old."expiresAt" <= now() then
      raise exception 'An expired certificate access grant cannot be revoked again.';
    end if;
    if (select auth.uid()) is null
       or new."revokedBy" is distinct from (select auth.uid())::text then
      raise exception 'Only the graduate who owns this grant can revoke it.';
    end if;
    new."revokedAt" := now();
  else
    raise exception 'Invalid certificate access grant state transition.';
  end if;

  new."updatedAt" := now();
  return new;
end;
$function$;

revoke all on function private.guard_certificate_access_grant_update() from public, anon, authenticated;


-- Fail closed on grants with a missing expiry in every verifier-facing read path.
drop policy if exists "verity_certificate_granted_verifier_read" on public."Certificate";
create policy "verity_certificate_granted_verifier_read"
  on public."Certificate"
  for select
  to authenticated
  using (
    exists (
      select 1
      from public."CertificateAccessGrant" g
      join public."Organization" o on o.id = g."organizationId"
      where g."certificateId" = "Certificate".id
        and g.status = 'APPROVED'
        and g."expiresAt" > now()
        and c.status = 'ACTIVE'
        and o."ownerId" = (select auth.uid())::text
        and o.type = 'EMPLOYER'
        and o.status = 'APPROVED'
    )
  );

-- The scoped policy already includes issuer, graduate and staff access.
-- Replace only its verifier branch with a strict non-null, unexpired grant.
drop policy if exists "verity_document_granted_verifier_read"
  on public."CertificateDocument";
drop policy if exists "verity_document_read_scoped"
  on public."CertificateDocument";
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
      private.is_active_org_staff("organizationId", 'certificates:read')
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
        and c.status = 'ACTIVE'
        and o."ownerId" = (select auth.uid())::text
        and o.type = 'EMPLOYER'
        and o.status = 'APPROVED'
    )
  );

drop policy if exists "verity_storage_granted_verifier_read"
  on storage.objects;
create policy "verity_storage_granted_verifier_read"
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
        and g.status = 'APPROVED'
        and g."expiresAt" > now()
        and o."ownerId" = (select auth.uid())::text
        and o.type = 'EMPLOYER'
        and o.status = 'APPROVED'
    )
  );


-- Let a graduate inspect the legal identity of an organization that requested
-- access, without making private organization rows generally readable.
create or replace function public.verity_graduate_consent_organization_details(p_grant_ids text[])
returns table (
  grant_id text,
  organization_name text,
  organization_type text,
  registration_number text,
  official_website text,
  official_email_domain text,
  accreditation_body text,
  verified_at timestamptz,
  location_city text,
  location_state text,
  location_country text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    g.id,
    o.name,
    o.type,
    o."registrationNumber",
    o."officialWebsite",
    o."officialEmailDomain",
    o."accreditationBody",
    o."verifiedAt",
    o."locationCity",
    o."locationState",
    o."locationCountry"
  from public."CertificateAccessGrant" g
  join public."Organization" o on o.id = g."organizationId"
  where g.id = any(p_grant_ids)
    and g."graduateId" = (select auth.uid())::text
    and o.status = 'APPROVED';
$function$;

revoke all on function public.verity_graduate_consent_organization_details(text[]) from public, anon;
grant execute on function public.verity_graduate_consent_organization_details(text[]) to authenticated;
