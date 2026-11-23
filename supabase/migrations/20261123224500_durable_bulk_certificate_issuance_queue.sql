-- VERITY durable bulk certificate issuance queue.
-- Additive durable bulk issuance queue. The application worker is enabled separately.
ALTER TABLE public."Certificate" ADD COLUMN IF NOT EXISTS "bulkIssuanceItemId" text;
CREATE UNIQUE INDEX IF NOT EXISTS "Certificate_bulk_issuance_item_unique"
  ON public."Certificate" ("bulkIssuanceItemId") WHERE "bulkIssuanceItemId" IS NOT NULL;
create table if not exists public."CertificateIssuanceBatch" (
  id text primary key,
  "organizationId" text not null references public."Organization"(id) on delete cascade,
  "createdBy" text not null references public."User"(id),
  "fileName" text not null check (char_length(btrim("fileName")) between 1 and 180),
  "method" text not null check ("method" in ('CSV_ZIP','CSV_MULTIPLE_PDFS','CSV_GENERATED')),
  "totalItems" integer not null check ("totalItems" between 1 and 500),
  "queuedItems" integer not null default 0 check ("queuedItems" between 0 and 500),
  "processingItems" integer not null default 0 check ("processingItems" between 0 and 500),
  "issuedItems" integer not null default 0 check ("issuedItems" between 0 and 500),
  "failedItems" integer not null default 0 check ("failedItems" between 0 and 500),
  "documentFailedItems" integer not null default 0 check ("documentFailedItems" between 0 and 500),
  status text not null default 'UPLOADING'
    check (status in ('UPLOADING','QUEUED','PROCESSING','COMPLETED','PARTIAL','FAILED','CANCELLED')),
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  "completedAt" timestamptz,
  constraint "CertificateIssuanceBatch_counts_valid"
    check ("queuedItems" + "processingItems" + "issuedItems" + "failedItems" <= "totalItems"
      and "documentFailedItems" <= "issuedItems")
);
create index if not exists "CertificateIssuanceBatch_org_created_idx"
  on public."CertificateIssuanceBatch" ("organizationId","createdAt" desc);

create table if not exists public."CertificateIssuanceItem" (
  id text primary key,
  "batchId" text not null references public."CertificateIssuanceBatch"(id) on delete cascade,
  "organizationId" text not null references public."Organization"(id) on delete cascade,
  "rowNumber" integer not null check ("rowNumber" >= 2),
  "studentNumber" text not null check (char_length(btrim("studentNumber")) between 2 and 80),
  "idempotencyKey" text not null check ("idempotencyKey" ~ '^[a-f0-9]{64}$'),
  payload jsonb not null check (jsonb_typeof(payload)='object'),
  "documentStoragePath" text,
  "documentName" text,
  "documentSha256" text check ("documentSha256" is null or "documentSha256" ~ '^[a-f0-9]{64}$'),
  status text not null default 'STAGED'
    check (status in ('STAGED','QUEUED','PROCESSING','ISSUED','ISSUED_DOCUMENT_FAILED','FAILED','NEEDS_REVIEW','CANCELLED')),
  attempts integer not null default 0 check (attempts between 0 and 10),
  "leaseToken" text,
  "leasedAt" timestamptz,
  "nextAttemptAt" timestamptz not null default now(),
  "certificateId" text references public."Certificate"("certificateId") on delete restrict,
  "errorCode" text,
  "errorMessage" text check ("errorMessage" is null or char_length("errorMessage") <= 500),
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  "processedAt" timestamptz,
  constraint "CertificateIssuanceItem_batch_row_unique" unique ("batchId","rowNumber"),
  constraint "CertificateIssuanceItem_batch_student_unique" unique ("batchId","studentNumber"),
  constraint "CertificateIssuanceItem_idempotency_unique" unique ("organizationId","idempotencyKey"),
  constraint "CertificateIssuanceItem_lease_consistent"
    check ((status='PROCESSING' and "leaseToken" is not null and "leasedAt" is not null)
      or (status<>'PROCESSING' and "leaseToken" is null and "leasedAt" is null))
);
create index if not exists "CertificateIssuanceItem_queue_idx"
  on public."CertificateIssuanceItem" ("nextAttemptAt","createdAt")
  where status='QUEUED';
create index if not exists "CertificateIssuanceItem_lease_idx"
  on public."CertificateIssuanceItem" ("leasedAt")
  where status='PROCESSING';

alter table public."CertificateIssuanceBatch" enable row level security;
alter table public."CertificateIssuanceItem" enable row level security;

drop policy if exists verity_certificate_issuance_batch_owner_read on public."CertificateIssuanceBatch";
create policy verity_certificate_issuance_batch_owner_read
  on public."CertificateIssuanceBatch" for select to authenticated
  using (
    exists(select 1 from public."Organization" o
      where o.id="CertificateIssuanceBatch"."organizationId"
        and o."ownerId"=(select auth.uid())::text and o.type='INSTITUTION')
    or (select private.is_admin())
  );

drop policy if exists verity_certificate_issuance_item_owner_read on public."CertificateIssuanceItem";
create policy verity_certificate_issuance_item_owner_read
  on public."CertificateIssuanceItem" for select to authenticated
  using (
    exists(select 1 from public."Organization" o
      where o.id="CertificateIssuanceItem"."organizationId"
        and o."ownerId"=(select auth.uid())::text and o.type='INSTITUTION')
    or (select private.is_admin())
  );

-- The browser can read job status only. All creation, payload writes, claims and
-- state transitions happen through authenticated server endpoints and service_role.
revoke all on public."CertificateIssuanceBatch" from public, anon, authenticated;
revoke all on public."CertificateIssuanceItem" from public, anon, authenticated;
grant select on public."CertificateIssuanceBatch" to authenticated;
grant select on public."CertificateIssuanceItem" to authenticated;
grant select,insert,update on public."CertificateIssuanceBatch" to service_role;
grant select,insert,update on public."CertificateIssuanceItem" to service_role;

-- Atomically claim one item. Expired worker leases are returned to the queue
-- only when no certificate has been attached; items with a certificate ID
-- require reconciliation and are never blindly issued again.
create or replace function public.claim_next_certificate_issuance_item(p_lease_token text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item public."CertificateIssuanceItem"%rowtype;
begin
  if p_lease_token is null or p_lease_token !~ '^[a-f0-9-]{36}$' then
    raise exception 'Invalid worker lease token';
  end if;

  -- Expired leases are never blindly reissued. Reconciliation first checks
  -- Certificate.bulkIssuanceItemId for a certificate committed before a crash.
  with expired as (
    update public."CertificateIssuanceItem"
      set status='NEEDS_REVIEW',
          "leaseToken"=null,
          "leasedAt"=null,
          "errorCode"='LEASE_EXPIRED_REQUIRES_RECONCILIATION',
          "errorMessage"='Worker lease expired. Check the certificate registry before retrying.',
          "processedAt"=now(),
          "updatedAt"=now()
      where status='PROCESSING'
        and "leasedAt" < now() - interval '10 minutes'
      returning "batchId"
  ), expired_counts as (
    select "batchId",count(*)::integer as amount
      from expired group by "batchId"
  )
  update public."CertificateIssuanceBatch" b
    set "processingItems"=greatest(0,b."processingItems"-e.amount),
        "failedItems"=least(b."totalItems",b."failedItems"+e.amount),
        status=case when b."queuedItems"=0 and b."processingItems"<=e.amount then 'PARTIAL' else b.status end,
        "completedAt"=case when b."queuedItems"=0 and b."processingItems"<=e.amount then now() else null end,
        "updatedAt"=now()
    from expired_counts e
    where b.id=e."batchId";

  -- A job that has exhausted its retry budget is terminal. If a certificate
  -- already exists, record the credential as issued but flag its document.
  with exhausted as (
    update public."CertificateIssuanceItem"
      set status=case when "certificateId" is null then 'FAILED' else 'ISSUED_DOCUMENT_FAILED' end,
          "errorCode"='MAX_ATTEMPTS_EXCEEDED',
          "errorMessage"='The item exhausted its automatic retry limit.',
          "processedAt"=now(),
          "updatedAt"=now()
      where status='QUEUED' and attempts>=10 and "nextAttemptAt"<=now()
      returning "batchId",status
  ), exhausted_counts as (
    select "batchId",
      count(*) filter(where status='FAILED')::integer as failed,
      count(*) filter(where status='ISSUED_DOCUMENT_FAILED')::integer as document_failed
    from exhausted group by "batchId"
  )
  update public."CertificateIssuanceBatch" b
    set "queuedItems"=greatest(0,b."queuedItems"-e.failed-e.document_failed),
        "failedItems"=least(b."totalItems",b."failedItems"+e.failed),
        "issuedItems"=least(b."totalItems",b."issuedItems"+e.document_failed),
        "documentFailedItems"=least(b."totalItems",b."documentFailedItems"+e.document_failed),
        status=case when b."queuedItems"<=e.failed+e.document_failed and b."processingItems"=0 then 'PARTIAL' else b.status end,
        "completedAt"=case when b."queuedItems"<=e.failed+e.document_failed and b."processingItems"=0 then now() else null end,
        "updatedAt"=now()
    from exhausted_counts e
    where b.id=e."batchId";

  select i.* into v_item
    from public."CertificateIssuanceItem" i
    join public."CertificateIssuanceBatch" b on b.id=i."batchId"
    where i.status='QUEUED'
      and i.attempts<10
      and i."nextAttemptAt"<=now()
      and b.status in ('QUEUED','PROCESSING')
    order by i."createdAt",i."rowNumber"
    for update of i skip locked
    limit 1;

  if not found then
    return jsonb_build_object('claimed',false);
  end if;

  update public."CertificateIssuanceItem"
    set status='PROCESSING', attempts=attempts+1,
        "leaseToken"=p_lease_token, "leasedAt"=now(), "updatedAt"=now()
    where id=v_item.id
    returning * into v_item;

  update public."CertificateIssuanceBatch"
    set status='PROCESSING',
        "queuedItems"=greatest(0,"queuedItems"-1),
        "processingItems"="processingItems"+1,
        "updatedAt"=now()
    where id=v_item."batchId";

  return jsonb_build_object('claimed',true,'item',to_jsonb(v_item));
end;
$$;

revoke all on function public.claim_next_certificate_issuance_item(text) from public,anon,authenticated;
grant execute on function public.claim_next_certificate_issuance_item(text) to service_role;

-- Finalize only with the active lease token. The worker must provide the exact
-- certificate ID it created; a completed/issued item cannot be finalized twice.
create or replace function public.finish_certificate_issuance_item(
  p_item_id text,
  p_lease_token text,
  p_status text,
  p_certificate_id text default null,
  p_error_code text default null,
  p_error_message text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item public."CertificateIssuanceItem"%rowtype;
  v_batch public."CertificateIssuanceBatch"%rowtype;
  v_final_status text;
  v_certificate_id text;
  v_backoff_seconds integer;
  v_terminal text;
begin
  if p_status not in ('ISSUED','ISSUED_DOCUMENT_FAILED','FAILED','NEEDS_REVIEW','RETRY') then
    raise exception 'Invalid issuance item result';
  end if;
  if p_error_message is not null and char_length(p_error_message)>500 then
    raise exception 'Error message is too long';
  end if;

  select * into v_item from public."CertificateIssuanceItem"
    where id=p_item_id for update;
  if not found or v_item.status<>'PROCESSING' or v_item."leaseToken"<>p_lease_token then
    raise exception 'Issuance item lease is no longer valid';
  end if;

  v_certificate_id:=coalesce(p_certificate_id,v_item."certificateId");
  if p_certificate_id is not null and v_item."certificateId" is not null
     and p_certificate_id<>v_item."certificateId" then
    raise exception 'A different certificate is already attached to this item';
  end if;
  if v_certificate_id is not null and not exists(
    select 1 from public."Certificate" c
    where c."certificateId"=v_certificate_id and c."bulkIssuanceItemId"=v_item.id
  ) then
    raise exception 'Certificate does not belong to this issuance item';
  end if;
  if p_status in ('ISSUED','ISSUED_DOCUMENT_FAILED') and v_certificate_id is null then
    raise exception 'An issued item must include its certificate ID';
  end if;
  if p_status in ('FAILED','NEEDS_REVIEW') and v_certificate_id is not null then
    raise exception 'A certificate-backed item cannot be marked as unissued failure';
  end if;

  if p_status='RETRY' and v_item.attempts<10 then
    v_backoff_seconds:=least(900,5*power(2,greatest(v_item.attempts-1,0))::integer);
    update public."CertificateIssuanceItem"
      set status='QUEUED',
          "certificateId"=v_certificate_id,
          "nextAttemptAt"=now()+make_interval(secs=>v_backoff_seconds),
          "errorCode"=left(p_error_code,80),
          "errorMessage"=left(p_error_message,500),
          "leaseToken"=null,"leasedAt"=null,
          "processedAt"=null,"updatedAt"=now()
      where id=p_item_id
      returning * into v_item;
    update public."CertificateIssuanceBatch"
      set "processingItems"=greatest(0,"processingItems"-1),
          "queuedItems"="queuedItems"+1,
          status=case when "processingItems">0 then 'PROCESSING' else 'QUEUED' end,"completedAt"=null,"updatedAt"=now()
      where id=v_item."batchId"
      returning * into v_batch;
    return jsonb_build_object('itemId',v_item.id,'itemStatus',v_item.status,
      'batchId',v_batch.id,'batchStatus',v_batch.status,
      'queuedItems',v_batch."queuedItems",'processingItems',v_batch."processingItems",
      'issuedItems',v_batch."issuedItems",'failedItems',v_batch."failedItems",
      'retryAfterSeconds',v_backoff_seconds);
  end if;

  v_final_status:=case
    when p_status='RETRY' and v_certificate_id is not null then 'ISSUED_DOCUMENT_FAILED'
    when p_status='RETRY' then 'FAILED'
    else p_status
  end;

  update public."CertificateIssuanceItem"
    set status=v_final_status,
        "certificateId"=v_certificate_id,
        "errorCode"=left(p_error_code,80),
        "errorMessage"=left(p_error_message,500),
        "leaseToken"=null,"leasedAt"=null,
        "processedAt"=now(),"updatedAt"=now()
    where id=p_item_id
    returning * into v_item;

  update public."CertificateIssuanceBatch"
    set "processingItems"=greatest(0,"processingItems"-1),
        "issuedItems"="issuedItems"+case when v_final_status in ('ISSUED','ISSUED_DOCUMENT_FAILED') then 1 else 0 end,
        "documentFailedItems"="documentFailedItems"+case when v_final_status='ISSUED_DOCUMENT_FAILED' then 1 else 0 end,
        "failedItems"="failedItems"+case when v_final_status in ('FAILED','NEEDS_REVIEW') then 1 else 0 end,
        "updatedAt"=now()
    where id=v_item."batchId"
    returning * into v_batch;

  v_terminal:=case
    when v_batch."processingItems"=0 and v_batch."queuedItems"=0
      and v_batch."failedItems"=0 and v_batch."documentFailedItems"=0 then 'COMPLETED'
    when v_batch."processingItems"=0 and v_batch."queuedItems"=0 then 'PARTIAL'
    when v_batch."processingItems">0 then 'PROCESSING'
    when v_batch."queuedItems">0 then 'QUEUED'
    else 'PROCESSING'
  end;
  update public."CertificateIssuanceBatch"
    set status=v_terminal,
        "completedAt"=case when v_terminal in ('COMPLETED','PARTIAL') then now() else null end,
        "updatedAt"=now()
    where id=v_batch.id;

  return jsonb_build_object('itemId',v_item.id,'itemStatus',v_item.status,
    'batchId',v_batch.id,'batchStatus',v_terminal,
    'issuedItems',v_batch."issuedItems",'documentFailedItems',v_batch."documentFailedItems",
    'failedItems',v_batch."failedItems",'queuedItems',v_batch."queuedItems",
    'processingItems',v_batch."processingItems");
end;
$$;

revoke all on function public.finish_certificate_issuance_item(text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.finish_certificate_issuance_item(text,text,text,text,text,text) to service_role;

create or replace function public.queue_certificate_issuance_batch(
  p_batch_id text,
  p_owner_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch public."CertificateIssuanceBatch"%rowtype;
  v_count integer;
begin
  select * into v_batch from public."CertificateIssuanceBatch"
    where id=p_batch_id for update;
  if not found then raise exception 'Issuance batch not found'; end if;
  if v_batch."createdBy"<>p_owner_id then raise exception 'Only the batch creator can submit this batch'; end if;
  if v_batch.status in ('QUEUED','PROCESSING','COMPLETED','PARTIAL','FAILED','CANCELLED') then
    return jsonb_build_object('queued',false,'alreadySubmitted',true,'batch',to_jsonb(v_batch));
  end if;
  if v_batch.status<>'UPLOADING' then raise exception 'Batch is not accepting submission'; end if;

  select count(*)::integer into v_count
    from public."CertificateIssuanceItem" i
    where i."batchId"=v_batch.id and i.status='STAGED';
  if v_count<>v_batch."totalItems" then
    raise exception 'All certificate rows must be staged before submitting the batch';
  end if;
  if exists(select 1 from public."CertificateIssuanceItem" i
      where i."batchId"=v_batch.id
        and (i."documentStoragePath" is null or i."documentSha256" is null)) then
    raise exception 'Every issuance item must have a validated private PDF before submission';
  end if;

  update public."CertificateIssuanceItem"
    set status='QUEUED',"nextAttemptAt"=now(),"updatedAt"=now()
    where "batchId"=v_batch.id and status='STAGED';
  update public."CertificateIssuanceBatch"
    set status='QUEUED',"queuedItems"=v_batch."totalItems",
        "updatedAt"=now(),"completedAt"=null
    where id=v_batch.id
    returning * into v_batch;
  return jsonb_build_object('queued',true,'batch',to_jsonb(v_batch));
end;
$$;

revoke all on function public.queue_certificate_issuance_batch(text,text) from public,anon,authenticated;
grant execute on function public.queue_certificate_issuance_batch(text,text) to service_role;

create or replace function public.reconcile_certificate_issuance_item(
  p_item_id text,
  p_document_failed boolean default false,
  p_error_message text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item public."CertificateIssuanceItem"%rowtype;
  v_batch public."CertificateIssuanceBatch"%rowtype;
  v_certificate_id text;
  v_status text;
  v_terminal text;
begin
  select * into v_item from public."CertificateIssuanceItem"
    where id=p_item_id for update;
  if not found or v_item.status<>'NEEDS_REVIEW' then
    return jsonb_build_object('reconciled',false,'reason','ITEM_NOT_REVIEWABLE');
  end if;

  select c."certificateId" into v_certificate_id
    from public."Certificate" c
    where c."bulkIssuanceItemId"=v_item.id;
  if not found then
    return jsonb_build_object('reconciled',false,'reason','NO_CERTIFICATE_FOUND');
  end if;

  v_status:=case when p_document_failed then 'ISSUED_DOCUMENT_FAILED' else 'ISSUED' end;
  update public."CertificateIssuanceItem"
    set status=v_status,"certificateId"=v_certificate_id,
        "errorCode"=case when p_document_failed then 'DOCUMENT_RECONCILIATION_FAILED' else null end,
        "errorMessage"=case when p_document_failed then left(p_error_message,500) else null end,
        "processedAt"=now(),"updatedAt"=now()
    where id=v_item.id;

  update public."CertificateIssuanceBatch"
    set "failedItems"=greatest(0,"failedItems"-1),
        "issuedItems"="issuedItems"+1,
        "documentFailedItems"="documentFailedItems"+case when p_document_failed then 1 else 0 end,
        "updatedAt"=now()
    where id=v_item."batchId"
    returning * into v_batch;

  v_terminal:=case
    when v_batch."processingItems"=0 and v_batch."queuedItems"=0
      and greatest(0,v_batch."failedItems")=0 and v_batch."documentFailedItems"=0 then 'COMPLETED'
    when v_batch."processingItems"=0 and v_batch."queuedItems"=0 then 'PARTIAL'
    when v_batch."queuedItems">0 then 'QUEUED'
    else 'PROCESSING'
  end;
  update public."CertificateIssuanceBatch"
    set status=v_terminal,
        "completedAt"=case when v_terminal in ('COMPLETED','PARTIAL') then now() else null end,
        "updatedAt"=now()
    where id=v_batch.id;

  return jsonb_build_object('reconciled',true,'itemId',v_item.id,
    'certificateId',v_certificate_id,'itemStatus',v_status,'batchStatus',v_terminal);
end;
$$;

revoke all on function public.reconcile_certificate_issuance_item(text,boolean,text) from public,anon,authenticated;
grant execute on function public.reconcile_certificate_issuance_item(text,boolean,text) to service_role;

-- Keep item tenancy and batch membership consistent even if a privileged
-- application path accidentally supplies a mismatched organization ID.
create or replace function public.guard_certificate_issuance_item_tenant()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org_id text;
  v_batch_status text;
begin
  select b."organizationId",b.status
    into v_org_id,v_batch_status
    from public."CertificateIssuanceBatch" b
    where b.id=new."batchId"
    for key share;

  if not found or v_org_id<>new."organizationId" then
    raise exception 'Issuance item organization must match its batch';
  end if;

  if tg_op='INSERT' then
    if v_batch_status<>'UPLOADING' or new.status<>'STAGED'
       or new.attempts<>0 or new."certificateId" is not null
       or new."leaseToken" is not null or new."leasedAt" is not null then
      raise exception 'New issuance items must be staged in an uploading batch';
    end if;
    if new."documentStoragePath" is null or new."documentStoragePath" !~ '^bulk-staging/'
       or new."documentName" is null or new."documentSha256" is null then
      raise exception 'A validated private bulk-staging PDF is required';
    end if;
  else
    if new."batchId"<>old."batchId"
      or new."organizationId"<>old."organizationId"
      or new."rowNumber"<>old."rowNumber"
      or new."studentNumber"<>old."studentNumber"
      or new."idempotencyKey"<>old."idempotencyKey"
      or new.payload<>old.payload
      or new."documentStoragePath" is distinct from old."documentStoragePath"
      or new."documentName" is distinct from old."documentName"
      or new."documentSha256" is distinct from old."documentSha256" then
      raise exception 'Staged issuance identity, payload and document are immutable';
    end if;

    if new.status<>old.status then
      if old.status='STAGED' and new.status='QUEUED' and v_batch_status='UPLOADING' then
        null;
      elsif old.status='QUEUED' and new.status='PROCESSING' and v_batch_status in ('QUEUED','PROCESSING') then
        null;
      elsif old.status='QUEUED' and new.status in ('FAILED','ISSUED_DOCUMENT_FAILED') and old.attempts>=10 then
        null;
      elsif old.status='PROCESSING' and new.status in ('QUEUED','ISSUED','ISSUED_DOCUMENT_FAILED','FAILED','NEEDS_REVIEW') then
        null;
      elsif old.status='NEEDS_REVIEW' and new.status in ('ISSUED','ISSUED_DOCUMENT_FAILED','FAILED') then
        null;
      else
        raise exception 'Invalid bulk certificate issuance state transition: % -> %',old.status,new.status;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists verity_guard_certificate_issuance_item_tenant
  on public."CertificateIssuanceItem";
create trigger verity_guard_certificate_issuance_item_tenant
  before insert or update on public."CertificateIssuanceItem"
  for each row execute function public.guard_certificate_issuance_item_tenant();

revoke all on function public.guard_certificate_issuance_item_tenant() from public,anon,authenticated;
grant execute on function public.guard_certificate_issuance_item_tenant() to service_role;
