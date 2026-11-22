-- Return only the disputed student and claimant identity to authorized institution
-- owners and ICT officers with registration:recover permission.
create or replace function public.list_verity_student_recovery_cases(p_organization_id text)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_rows jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if not exists(
  select 1 from public."Organization" o
  where o.id=p_organization_id and (
   o."ownerId"=auth.uid()::text
   or exists(select 1 from public."InstitutionICTStaff" i
    where i."organizationId"=o.id and i."userId"=auth.uid()::text
     and i.status='ACTIVE' and 'registration:recover'=any(i.permissions))
  )
 ) then raise exception 'Institution registration-recovery permission is required'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',x.id,'organizationId',x."organizationId",'rosterId',x."rosterId",
  'reportedBy',x."reportedBy",'reviewedBy',x."reviewedBy",
  'secondApprovedBy',x."secondApprovedBy",'secondApprovedAt',x."secondApprovedAt",
  'reason',x.reason,'status',x.status,'resolutionNotes',x."resolutionNotes",
  'createdAt',x."createdAt",'resolvedAt',x."resolvedAt",
  'StudentRoster',jsonb_build_object(
   'studentNumber',x."studentNumber",'fullName',x."studentName",
   'status',x."rosterStatus",'claimedUserId',x."claimedUserId",'claimedAt',x."claimedAt"
  ),
  'claimedBy',case when x."claimantId" is null then null else jsonb_build_object(
   'id',x."claimantId",'fullName',x."claimantName",'email',x."claimantEmail"
  ) end
 ) order by x."createdAt" desc),'[]'::jsonb)
 into v_rows
 from (
  select r.*,sr."studentNumber",sr."fullName" as "studentName",
   sr.status as "rosterStatus",sr."claimedUserId",sr."claimedAt",
   u.id as "claimantId",u."fullName" as "claimantName",u.email as "claimantEmail"
  from public."StudentRegistrationRecovery" r
  join public."StudentRoster" sr on sr.id=r."rosterId"
  left join public."User" u on u.id=sr."claimedUserId"
  where r."organizationId"=p_organization_id
  order by r."createdAt" desc limit 200
 ) x;
 return v_rows;
end;
$$;
revoke all on function public.list_verity_student_recovery_cases(text) from public;
grant execute on function public.list_verity_student_recovery_cases(text) to authenticated;
