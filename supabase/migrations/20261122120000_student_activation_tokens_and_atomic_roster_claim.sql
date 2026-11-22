-- VERITY single-use student activation tokens and atomic roster claim.
create table if not exists public."StudentActivationToken" (
 "id" text primary key default gen_random_uuid()::text,
 "organizationId" text not null references public."Organization"("id") on delete cascade,
 "rosterId" text not null unique references public."StudentRoster"("id") on delete cascade,
 "tokenHash" text not null unique,
 "tokenLastFour" text not null,
 "issuedBy" text not null references public."User"("id"),
 "createdAt" timestamptz not null default now(),
 "expiresAt" timestamptz,
 "usedAt" timestamptz,
 "usedBy" text references public."User"("id"),
 "revokedAt" timestamptz
);
create index if not exists "StudentActivationToken_organization_created_idx"
 on public."StudentActivationToken"("organizationId","createdAt" desc);
alter table public."StudentActivationToken" enable row level security;
drop policy if exists "Institution owners and ICT manage activation tokens" on public."StudentActivationToken";
create policy "Institution owners and ICT manage activation tokens"
 on public."StudentActivationToken" for all to authenticated
 using (
  exists(select 1 from public."Organization" o where o.id="StudentActivationToken"."organizationId" and o."ownerId"=auth.uid()::text)
  or exists(select 1 from public."InstitutionICTStaff" i where i."organizationId"="StudentActivationToken"."organizationId" and i."userId"=auth.uid()::text and i.status='ACTIVE' and 'roster:manage'=any(i.permissions))
 )
 with check (
  exists(select 1 from public."Organization" o where o.id="StudentActivationToken"."organizationId" and o."ownerId"=auth.uid()::text)
  or exists(select 1 from public."InstitutionICTStaff" i where i."organizationId"="StudentActivationToken"."organizationId" and i."userId"=auth.uid()::text and i.status='ACTIVE' and 'roster:manage'=any(i.permissions))
 );
grant select,insert,update,delete on public."StudentActivationToken" to authenticated;
create or replace function public.verity_student_registration_precheck(p_organization_id text,p_student_number text)
returns boolean language sql stable security definer set search_path=''
as $$
 select exists(
  select 1 from public."Organization" o join public."StudentRoster" r on r."organizationId"=o.id
  where o.id=p_organization_id and o.type='INSTITUTION' and o.status='APPROVED' and o."directoryVisible" is true
   and r."normalizedStudentNumber"=upper(regexp_replace(trim(coalesce(p_student_number,'')),'\\s+','','g'))
   and r.status='ELIGIBLE' and r."claimedUserId" is null
 );
$$;
revoke all on function public.verity_student_registration_precheck(text,text) from public;
grant execute on function public.verity_student_registration_precheck(text,text) to anon,authenticated;
create or replace function public.verity_student_signup_institutions()
returns table(id text,name text,"locationCity" text,"locationState" text,"locationCountry" text)
language sql stable security definer set search_path=''
as $$
 select o.id,o.name,o."locationCity",o."locationState",o."locationCountry"
 from public."Organization" o
 where o.type='INSTITUTION' and o.status='APPROVED' and o."directoryVisible" is true
 order by o.name limit 500;
$$;
revoke all on function public.verity_student_signup_institutions() from public;
grant execute on function public.verity_student_signup_institutions() to anon,authenticated;
create or replace function public.activate_verity_student_roster(
 p_organization_id text,p_student_number text,p_token_hash text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
 v_user public."User"%rowtype; v_org public."Organization"%rowtype;
 v_roster public."StudentRoster"%rowtype; v_token public."StudentActivationToken"%rowtype;
 v_membership_id text; v_number text;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select * into v_user from public."User" where id=auth.uid()::text;
 if not found or v_user.role <> 'GRADUATE'::public."Role" then raise exception 'Only graduate accounts can activate a student record'; end if;
 select * into v_org from public."Organization" where id=p_organization_id and type='INSTITUTION' and status='APPROVED';
 if not found then raise exception 'Institution is unavailable for student activation'; end if;
 v_number=upper(regexp_replace(trim(coalesce(p_student_number,'')),'\\s+','','g'));
 if length(v_number)<2 or length(v_number)>80 then raise exception 'Enter a valid matriculation number'; end if;
 select * into v_roster from public."StudentRoster" where "organizationId"=v_org.id and "normalizedStudentNumber"=v_number for update;
 if not found then raise exception 'Student details could not be verified. Contact the institution ICT office.'; end if;
 if v_roster.status='ACTIVE' and v_roster."claimedUserId" is not null then
  if v_roster."claimedUserId"=auth.uid()::text then return jsonb_build_object('activated',true,'alreadyLinked',true,'institutionName',v_org.name); end if;
  raise exception 'This student record is already linked. Contact institution ICT for an identity review.';
 end if;
 if v_roster.status not in ('ELIGIBLE','CLAIM_PENDING') then raise exception 'This student record is not available for self-activation. Contact institution ICT.'; end if;
 select * into v_token from public."StudentActivationToken" where "rosterId"=v_roster.id and "organizationId"=v_org.id for update;
 if not found or v_token."tokenHash"<>p_token_hash or v_token."usedAt" is not null or v_token."revokedAt" is not null or (v_token."expiresAt" is not null and v_token."expiresAt"<=now()) then
  raise exception 'The activation token is invalid, already used or no longer active. Contact institution ICT.';
 end if;
 update public."StudentActivationToken" set "usedAt"=now(),"usedBy"=auth.uid()::text where id=v_token.id;
 update public."StudentRoster" set status='ACTIVE',"claimedUserId"=auth.uid()::text,"claimedAt"=now(),"updatedAt"=now() where id=v_roster.id;
 update public."User" set "fullName"=v_roster."fullName" where id=auth.uid()::text;
 insert into public."Membership"(id,"organizationId","userId","studentNumber",status)
 values(gen_random_uuid()::text,v_org.id,auth.uid()::text,v_roster."studentNumber",'ACTIVE')
 on conflict ("organizationId","userId") do update set "studentNumber"=excluded."studentNumber",status='ACTIVE',"updatedAt"=now()
 returning id into v_membership_id;
 return jsonb_build_object('activated',true,'membershipId',v_membership_id,'institutionName',v_org.name,'studentNumber',v_roster."studentNumber");
end;
$$;
revoke all on function public.activate_verity_student_roster(text,text,text) from public;
grant execute on function public.activate_verity_student_roster(text,text,text) to authenticated;

-- Additional recovery fields and two-person review functions are deployed by
-- institution_student_recovery_two_person_workflow and subsequent hardening migrations.
alter table public."StudentRegistrationRecovery"
 add column if not exists "secondApprovedBy" text references public."User"("id"),
 add column if not exists "secondApprovedAt" timestamptz;
