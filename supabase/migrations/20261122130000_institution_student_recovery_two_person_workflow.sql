-- Two-person Institution ICT review for disputed student claims.
alter table public."StudentRegistrationRecovery"
 add column if not exists "secondApprovedBy" text references public."User"("id"),
 add column if not exists "secondApprovedAt" timestamptz;
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
create or replace function public.review_verity_student_recovery(p_recovery_id text,p_decision text,p_notes text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_case public."StudentRegistrationRecovery"%rowtype; v_roster public."StudentRoster"%rowtype; v_org public."Organization"%rowtype;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if p_decision not in ('APPROVED','REJECTED') or length(trim(coalesce(p_notes,'')))<10 then raise exception 'A decision and at least 10 characters of review notes are required'; end if;
 select * into v_case from public."StudentRegistrationRecovery" where id=p_recovery_id for update;
 if not found then raise exception 'Recovery case not found'; end if;
 select * into v_org from public."Organization" where id=v_case."organizationId";
 if not found or not (v_org."ownerId"=auth.uid()::text or exists(select 1 from public."InstitutionICTStaff" i where i."organizationId"=v_org.id and i."userId"=auth.uid()::text and i.status='ACTIVE' and 'registration:recover'=any(i.permissions))) then raise exception 'Institution registration-recovery permission is required'; end if;
 if v_case.status<>'OPEN' then raise exception 'Only open recovery cases can be reviewed'; end if;
 select * into v_roster from public."StudentRoster" where id=v_case."rosterId" for update;
 if not found then raise exception 'Student roster record not found'; end if;
 if p_decision='REJECTED' then
  update public."StudentRoster" set status=case when "claimedUserId" is null then 'ELIGIBLE' else 'ACTIVE' end,"updatedAt"=now() where id=v_roster.id;
  update public."StudentRegistrationRecovery" set status='REJECTED',"reviewedBy"=auth.uid()::text,"resolutionNotes"=trim(p_notes),"resolvedAt"=now() where id=v_case.id;
 else
  update public."StudentRegistrationRecovery" set status='APPROVED',"reviewedBy"=auth.uid()::text,"resolutionNotes"=trim(p_notes) where id=v_case.id;
 end if;
 return jsonb_build_object('caseId',v_case.id,'status',p_decision,'rosterId',v_roster.id);
end;
$$;
revoke all on function public.review_verity_student_recovery(text,text,text) from public;
grant execute on function public.review_verity_student_recovery(text,text,text) to authenticated;
create or replace function public.complete_verity_student_recovery(p_recovery_id text,p_notes text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_case public."StudentRegistrationRecovery"%rowtype; v_roster public."StudentRoster"%rowtype; v_org public."Organization"%rowtype; v_claimant text;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if length(trim(coalesce(p_notes,'')))<10 then raise exception 'Second officer review notes must contain at least 10 characters'; end if;
 select * into v_case from public."StudentRegistrationRecovery" where id=p_recovery_id for update;
 if not found then raise exception 'Recovery case not found'; end if;
 select * into v_org from public."Organization" where id=v_case."organizationId";
 if not found or not (v_org."ownerId"=auth.uid()::text or exists(select 1 from public."InstitutionICTStaff" i where i."organizationId"=v_org.id and i."userId"=auth.uid()::text and i.status='ACTIVE' and 'registration:recover'=any(i.permissions))) then raise exception 'Institution registration-recovery permission is required'; end if;
 if v_case.status<>'APPROVED' or v_case."reviewedBy" is null or v_case."reviewedBy"=auth.uid()::text or v_case."secondApprovedBy" is not null then raise exception 'A second authorized officer, different from the first reviewer, must complete this case'; end if;
 select * into v_roster from public."StudentRoster" where id=v_case."rosterId" and "organizationId"=v_org.id for update;
 if not found or v_roster.status<>'DISPUTED' then raise exception 'The disputed student roster record is not available for recovery'; end if;
 v_claimant:=v_roster."claimedUserId";
 if v_claimant is not null then
  if exists(select 1 from public."Certificate" c where c."graduateId"=v_claimant and c."organizationId"=v_org.id and c."studentNumber"=v_roster."studentNumber") then raise exception 'This account has certificate records. VERITY Admin must review the credential ownership history before any reassignment.'; end if;
  update public."Membership" set status='REJECTED',"updatedAt"=now() where "organizationId"=v_org.id and "userId"=v_claimant;
 end if;
 update public."StudentRoster" set status='ELIGIBLE',"claimedUserId"=null,"claimedAt"=null,"updatedAt"=now() where id=v_roster.id;
 update public."StudentRegistrationRecovery" set status='COMPLETED',"secondApprovedBy"=auth.uid()::text,"secondApprovedAt"=now(),"resolvedAt"=now(),"resolutionNotes"=concat(coalesce("resolutionNotes",''),' | Second approval: ',trim(p_notes)) where id=v_case.id;
 return jsonb_build_object('caseId',v_case.id,'rosterId',v_roster.id,'studentNumber',v_roster."studentNumber",'claimedUserId',v_claimant,'organizationId',v_org.id,'status','COMPLETED');
end;
$$;
revoke all on function public.complete_verity_student_recovery(text,text) from public;
grant execute on function public.complete_verity_student_recovery(text,text) to authenticated;
