-- Allow institution ICT officers with registration:recover to issue the fresh
-- single-use activation token after a separately approved two-person recovery.
drop policy if exists "Institution owners and ICT manage activation tokens" on public."StudentActivationToken";
create policy "Institution owners and ICT manage activation tokens"
 on public."StudentActivationToken" for all to authenticated
 using (
  exists(select 1 from public."Organization" o where o.id="StudentActivationToken"."organizationId" and o."ownerId"=auth.uid()::text)
  or exists(select 1 from public."InstitutionICTStaff" i where i."organizationId"="StudentActivationToken"."organizationId" and i."userId"=auth.uid()::text and i.status='ACTIVE' and ('roster:manage'=any(i.permissions) or 'registration:recover'=any(i.permissions)))
 )
 with check (
  exists(select 1 from public."Organization" o where o.id="StudentActivationToken"."organizationId" and o."ownerId"=auth.uid()::text)
  or exists(select 1 from public."InstitutionICTStaff" i where i."organizationId"="StudentActivationToken"."organizationId" and i."userId"=auth.uid()::text and i.status='ACTIVE' and ('roster:manage'=any(i.permissions) or 'registration:recover'=any(i.permissions)))
 );
