CREATE OR REPLACE FUNCTION public.request_verity_membership(p_registration_code text, p_student_number text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_org public."Organization"%rowtype;
  v_user public."User"%rowtype;
  v_id text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_user from public."User" where id=auth.uid()::text;
  if not found or v_user.role <> 'GRADUATE'::public."Role" then
    raise exception 'Only student accounts can request institution membership';
  end if;
  select * into v_org from public."Organization"
    where upper("registrationCode")=upper(trim(p_registration_code));
  if not found or v_org.status <> 'APPROVED' then
    raise exception 'Organization code is invalid or the organization is not approved';
  end if;
  if v_org."registrationCodeExpiryEnabled"
     and (v_org."registrationCodeExpiresAt" is null or v_org."registrationCodeExpiresAt" <= now()) then
    raise exception 'This institution registration code has expired. Contact the institution ICT office.';
  end if;
  insert into public."Membership"(id,"organizationId","userId","studentNumber",status)
  values(gen_random_uuid()::text,v_org.id,auth.uid()::text,nullif(trim(p_student_number),''),'PENDING')
  on conflict ("organizationId","userId") do update
    set "studentNumber"=excluded."studentNumber","updatedAt"=now()
  returning id into v_id;
  return jsonb_build_object('requested',true,'membershipId',v_id,'organizationName',v_org.name,'status','PENDING');
end;
$function$;
