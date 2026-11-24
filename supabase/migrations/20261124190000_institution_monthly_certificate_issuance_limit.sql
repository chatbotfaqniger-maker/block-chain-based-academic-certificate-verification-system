-- VERITY: enforce one shared 8,000-certificate monthly allowance per issuer.
-- Existing campaigns, batches, templates, certificates, documents and storage paths are preserved.
-- Campaign creation reserves the declared item count for the UTC calendar month.
-- Replaying the same campaign UUID is idempotent and never reserves quota twice.
create or replace function public.create_certificate_issuance_campaign_with_monthly_limit(
  p_campaign_id text,p_organization_id text,p_owner_id text,p_file_name text,p_method text,p_total_items integer
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_campaign public."CertificateIssuanceCampaign"%rowtype;
  v_existing public."CertificateIssuanceCampaign"%rowtype;
  v_month_start timestamptz;
  v_month_end timestamptz;
  v_used integer;
begin
  if p_campaign_id is null or char_length(btrim(p_campaign_id)) not between 1 and 100 then raise exception 'Invalid issuance campaign identifier'; end if;
  if p_organization_id is null or p_owner_id is null then raise exception 'Issuing organization and creator are required'; end if;
  if p_file_name is null or char_length(btrim(p_file_name)) not between 1 and 180 then raise exception 'Invalid issuance campaign file name'; end if;
  if p_method is null or p_method not in ('CSV_ZIP','CSV_MULTIPLE_PDFS','CSV_GENERATED') then raise exception 'Invalid issuance campaign method'; end if;
  if p_total_items is null or p_total_items < 1 or p_total_items > 50000 then raise exception 'An issuance campaign must contain between 1 and 50,000 records'; end if;

  -- Serialize reservations for one institution to prevent concurrent oversubscription.
  perform 1 from public."Organization" where id=p_organization_id for update;
  if not found then raise exception 'Issuing organization not found'; end if;

  v_month_start := date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
  v_month_end := v_month_start + interval '1 month';
  select coalesce(sum("totalItems"),0)::integer into v_used
    from public."CertificateIssuanceCampaign"
    where "organizationId"=p_organization_id and "createdAt">=v_month_start and "createdAt"<v_month_end;

  -- A retry with the original campaign UUID returns its original reservation.
  select * into v_existing from public."CertificateIssuanceCampaign" where id=p_campaign_id;
  if found then
    if v_existing."organizationId" is distinct from p_organization_id
       or v_existing."createdBy" is distinct from p_owner_id
       or v_existing."fileName" is distinct from left(p_file_name,180)
       or v_existing.method is distinct from p_method
       or v_existing."totalItems" is distinct from p_total_items then
      raise exception 'Campaign identifier is already bound to a different issuance request';
    end if;
    return jsonb_build_object('campaign',to_jsonb(v_existing),'alreadyCreated',true,'monthlyLimit',8000,
      'monthlyUsed',v_used,'monthlyRemaining',greatest(0,8000-v_used),'resetAt',v_month_end);
  end if;

  -- Previously created campaigns above 8,000 remain resumable; only new reservations are capped.
  if v_used+p_total_items>8000 then
    return jsonb_build_object('limitExceeded',true,'monthlyLimit',8000,'monthlyUsed',v_used,
      'monthlyRemaining',greatest(0,8000-v_used),'resetAt',v_month_end);
  end if;

  insert into public."CertificateIssuanceCampaign"(id,"organizationId","createdBy","fileName",method,"totalItems")
    values(p_campaign_id,p_organization_id,p_owner_id,left(p_file_name,180),p_method,p_total_items)
    returning * into v_campaign;
  v_used:=v_used+p_total_items;
  return jsonb_build_object('campaign',to_jsonb(v_campaign),'alreadyCreated',false,'monthlyLimit',8000,
    'monthlyUsed',v_used,'monthlyRemaining',greatest(0,8000-v_used),'resetAt',v_month_end);
end;
$$;

revoke all on function public.create_certificate_issuance_campaign_with_monthly_limit(text,text,text,text,text,integer)
  from public,anon,authenticated;
grant execute on function public.create_certificate_issuance_campaign_with_monthly_limit(text,text,text,text,text,integer)
  to service_role;
comment on function public.create_certificate_issuance_campaign_with_monthly_limit(text,text,text,text,text,integer) is
  'Atomically reserves up to 8,000 certificate records per institution per UTC calendar month across all issuance campaigns. Same campaign UUID retries are idempotent.';
