-- Scope roster lookup to the exact institution and return claimant identity only
-- to that institution's owner or active ICT roster managers.
create or replace function public.list_verity_student_roster(p_organization_id text,p_search text default null)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_org public."Organization"%rowtype; v_rows jsonb; v_counts jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select o.* into v_org from public."Organization" o
 where o.id=p_organization_id and o.type='INSTITUTION' and o.status='APPROVED'
 and (o."ownerId"=auth.uid()::text or exists(
  select 1 from public."InstitutionICTStaff" i where i."organizationId"=o.id
   and i."userId"=auth.uid()::text and i.status='ACTIVE' and 'roster:manage'=any(i.permissions)
 ));
 if not found then raise exception 'Institution roster-management permission is required'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',x.id,'studentNumber',x."studentNumber",'fullName',x."fullName",
  'institutionalEmail',x."institutionalEmail",'faculty',x.faculty,'department',x.department,
  'programme',x.programme,'academicSession',x."academicSession",'status',x.status,
  'claimedUserId',x."claimedUserId",'claimedAt',x."claimedAt",'createdAt',x."createdAt",
  'claimedBy',case when x."claimantId" is null then null else jsonb_build_object(
   'id',x."claimantId",'fullName',x."claimantName",'email',x."claimantEmail"
  ) end
 ) order by x."createdAt" desc),'[]'::jsonb) into v_rows
 from (
  select r.*,u.id as "claimantId",u."fullName" as "claimantName",u.email as "claimantEmail"
  from public."StudentRoster" r left join public."User" u on u.id=r."claimedUserId"
  where r."organizationId"=v_org.id
   and (nullif(trim(coalesce(p_search,'')),'') is null
    or r."studentNumber" ilike '%'||trim(p_search)||'%'
    or r."fullName" ilike '%'||trim(p_search)||'%')
  order by r."createdAt" desc limit 500
 ) x;
 select coalesce(jsonb_object_agg(status,total),'{}'::jsonb) into v_counts
 from (select r.status,count(*)::int as total from public."StudentRoster" r where r."organizationId"=v_org.id group by r.status) counts;
 return jsonb_build_object('organization',jsonb_build_object('id',v_org.id,'name',v_org.name,'registrationCode',v_org."registrationCode",'registrationCodeExpiryEnabled',v_org."registrationCodeExpiryEnabled",'registrationCodeExpiresAt',v_org."registrationCodeExpiresAt"),'students',v_rows,'counts',v_counts);
end;
$$;
revoke all on function public.list_verity_student_roster(text,text) from public;
grant execute on function public.list_verity_student_roster(text,text) to authenticated;
