-- VERITY large issuance campaigns.
-- A campaign can contain up to 50,000 student records and is orchestrated
-- through the existing durable 500-item processing batches. Existing batches
-- remain valid and are not rewritten.
create table if not exists public."CertificateIssuanceCampaign" (
  id text primary key,
  "organizationId" text not null references public."Organization"(id) on delete cascade,
  "createdBy" text not null references public."User"(id),
  "fileName" text not null check (char_length(btrim("fileName")) between 1 and 180),
  method text not null check (method in ('CSV_ZIP','CSV_MULTIPLE_PDFS','CSV_GENERATED')),
  "totalItems" integer not null check ("totalItems" between 1 and 50000),
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

alter table public."CertificateIssuanceBatch"
  add column if not exists "campaignId" text
  references public."CertificateIssuanceCampaign"(id) on delete cascade;

create index if not exists "CertificateIssuanceCampaign_org_created_idx"
  on public."CertificateIssuanceCampaign" ("organizationId","createdAt" desc);
create index if not exists "CertificateIssuanceBatch_campaign_idx"
  on public."CertificateIssuanceBatch" ("campaignId","createdAt");

alter table public."CertificateIssuanceCampaign" enable row level security;
drop policy if exists verity_certificate_issuance_campaign_owner_read
  on public."CertificateIssuanceCampaign";
create policy verity_certificate_issuance_campaign_owner_read
  on public."CertificateIssuanceCampaign" for select to authenticated
  using (
    exists (
      select 1 from public."Organization" o
      where o.id="CertificateIssuanceCampaign"."organizationId"
        and o."ownerId"=(select auth.uid())::text
        and o.type='INSTITUTION'
    )
    or (select private.is_admin())
  );

revoke all on public."CertificateIssuanceCampaign" from public, anon, authenticated;
grant select on public."CertificateIssuanceCampaign" to authenticated;
grant select,insert,update on public."CertificateIssuanceCampaign" to service_role;
grant select,insert,update on public."CertificateIssuanceBatch" to service_role;

-- Enforce the 500-item processing chunk inside the database while allowing
-- multiple chunks to belong to one larger campaign. This RPC serializes
-- campaign allocation to prevent concurrent requests from oversubscribing it.
create or replace function public.create_certificate_issuance_campaign_batch(
  p_campaign_id text,
  p_batch_id text,
  p_owner_id text,
  p_file_name text,
  p_method text,
  p_total_items integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_campaign public."CertificateIssuanceCampaign"%rowtype;
  v_allocated integer;
  v_batch public."CertificateIssuanceBatch"%rowtype;
begin
  if p_total_items is null or p_total_items < 1 or p_total_items > 500 then
    raise exception 'A processing batch must contain between 1 and 500 items';
  end if;
  select * into v_campaign
    from public."CertificateIssuanceCampaign"
    where id=p_campaign_id
    for update;
  if not found then raise exception 'Issuance campaign not found'; end if;
  if v_campaign."createdBy"<>p_owner_id then
    raise exception 'Only the campaign creator can allocate processing batches';
  end if;
  if p_method<>v_campaign.method then
    raise exception 'Processing batch method must match its campaign';
  end if;
  if p_file_name is null or char_length(btrim(p_file_name)) not between 1 and 180 then
    raise exception 'Invalid processing batch file name';
  end if;

  -- Client-generated batch IDs make a timed-out creation request safe to retry.
  select * into v_batch
    from public."CertificateIssuanceBatch"
    where id=p_batch_id;
  if found then
    if v_batch."campaignId" is distinct from p_campaign_id
       or v_batch."createdBy" is distinct from p_owner_id
       or v_batch."totalItems" is distinct from p_total_items
       or v_batch.method is distinct from p_method then
      raise exception 'Processing batch identifier is already bound to a different request';
    end if;
    select coalesce(sum("totalItems"),0)::integer into v_allocated
      from public."CertificateIssuanceBatch"
      where "campaignId"=p_campaign_id;
    return jsonb_build_object('batch',to_jsonb(v_batch),'allocatedItems',v_allocated);
  end if;

  select coalesce(sum("totalItems"),0)::integer into v_allocated
    from public."CertificateIssuanceBatch"
    where "campaignId"=p_campaign_id;
  if v_allocated+p_total_items>v_campaign."totalItems" then
    raise exception 'Processing batches exceed the campaign item count';
  end if;

  insert into public."CertificateIssuanceBatch"(
    id,"campaignId","organizationId","createdBy","fileName",method,"totalItems",status
  ) values (
    p_batch_id,p_campaign_id,v_campaign."organizationId",p_owner_id,
    left(p_file_name,180),p_method,p_total_items,'UPLOADING'
  ) returning * into v_batch;

  update public."CertificateIssuanceCampaign"
    set "updatedAt"=now()
    where id=p_campaign_id;

  return jsonb_build_object('batch',to_jsonb(v_batch),'allocatedItems',v_allocated+p_total_items);
end;
$$;

revoke all on function public.create_certificate_issuance_campaign_batch(text,text,text,text,text,integer)
  from public,anon,authenticated;
grant execute on function public.create_certificate_issuance_campaign_batch(text,text,text,text,text,integer)
  to service_role;

comment on table public."CertificateIssuanceCampaign" is
  'Institution-level issuance campaign; items are processed through durable CertificateIssuanceBatch chunks of at most 500.';
