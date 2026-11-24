-- Atomically convert an institution-approved historical certificate into a
-- canonical VERITY certificate. The Certificate INSERT invokes the existing
-- append-only ledger trigger; the case transition and certificate insert commit
-- or roll back together. Original scan evidence is never moved or deleted.
create or replace function public.verity_convert_digitization_case(
  p_case_id text,
  p_certificate jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public."CertificateDigitizationCase"%rowtype;
  v_record public."Certificate"%rowtype;
  v_org_name text;
begin
  if p_certificate is null or jsonb_typeof(p_certificate) <> 'object' then
    raise exception 'A complete canonical certificate record is required';
  end if;

  select * into v_case
  from public."CertificateDigitizationCase"
  where id = p_case_id
  for update;

  if not found then
    raise exception 'Digitisation case not found';
  end if;

  if v_case.status = 'ISSUED' and v_case."certificateId" is not null then
    select * into v_record from public."Certificate"
    where "certificateId" = v_case."certificateId";
    if not found then
      raise exception 'Issued digitisation case is missing its certificate record';
    end if;
    return to_jsonb(v_record);
  end if;

  if v_case.status <> 'APPROVED' then
    raise exception 'Only institution-approved digitisation cases can be converted';
  end if;

  select name into v_org_name from public."Organization"
  where id = v_case."organizationId" and status = 'APPROVED' and type = 'INSTITUTION';
  if v_org_name is null then
    raise exception 'The issuing institution must remain approved';
  end if;

  if p_certificate->>'organizationId' is distinct from v_case."organizationId"
     or p_certificate->>'studentNumber' is distinct from v_case."studentNumber"
     or p_certificate->>'studentName' is distinct from v_case."claimedStudentName"
     or p_certificate->>'institution' is distinct from v_org_name
     or p_certificate->>'issuerId' is distinct from v_case."reviewedBy" then
    raise exception 'Certificate identity does not match the approved historical case';
  end if;

  if nullif(btrim(p_certificate->>'id'), '') is null
     or nullif(btrim(p_certificate->>'certificateId'), '') is null
     or nullif(btrim(p_certificate->>'verificationKey'), '') is null
     or nullif(btrim(p_certificate->>'digest'), '') is null then
    raise exception 'Certificate identifiers and digest are required';
  end if;

  insert into public."Certificate"
  select (jsonb_populate_record(null::public."Certificate", p_certificate)).* 
  returning * into v_record;

  update public."CertificateDigitizationCase"
  set status = 'ISSUED',
      "certificateId" = v_record."certificateId",
      "issuedAt" = now()
  where id = v_case.id and status = 'APPROVED';

  if not found then
    raise exception 'Digitisation case could not be marked as issued';
  end if;

  return to_jsonb(v_record);
end;
$$;

revoke all on function public.verity_convert_digitization_case(text,jsonb) from public, anon, authenticated;
grant execute on function public.verity_convert_digitization_case(text,jsonb) to service_role;
