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
