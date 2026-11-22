-- Execute queue lifecycle and expired-lease reconciliation against real PostgreSQL.
insert into public."User"(id) values ('ci-user');
insert into public."Organization"(id,"ownerId",type,status)
values ('ci-institution','ci-user','INSTITUTION','APPROVED');

insert into public."CertificateIssuanceBatch"
(id,"organizationId","createdBy","fileName","method","totalItems","queuedItems",status)
values ('ci-batch-issued','ci-institution','ci-user','batch.csv','CSV_GENERATED',1,0,'UPLOADING');
insert into public."CertificateIssuanceItem"
(id,"batchId","organizationId","rowNumber","studentNumber","idempotencyKey",payload,status)
values ('ci-item-issued','ci-batch-issued','ci-institution',2,'STU-001',repeat('a',64),
'{"studentName":"Test Student","studentNumber":"STU-001"}'::jsonb,'STAGED');
update public."CertificateIssuanceItem" set status='QUEUED' where id='ci-item-issued';
update public."CertificateIssuanceBatch" set status='QUEUED',"queuedItems"=1 where id='ci-batch-issued';

do $$
declare result jsonb;
begin
  result:=public.claim_next_certificate_issuance_item('11111111-1111-4111-8111-111111111111');
  if coalesce((result->>'claimed')::boolean,false) is not true then
    raise exception 'Expected first issuance item to be claimed';
  end if;
  result:=public.finish_certificate_issuance_item(
    'ci-item-issued','11111111-1111-4111-8111-111111111111','ISSUED','VRT-CI-001',null,null
  );
  if result->>'itemStatus'<>'ISSUED' or result->>'batchStatus'<>'COMPLETED' then
    raise exception 'Expected successful item and batch completion, got %',result;
  end if;
end $$;

insert into public."CertificateIssuanceBatch"
(id,"organizationId","createdBy","fileName","method","totalItems","queuedItems",status)
values ('ci-batch-expired','ci-institution','ci-user','expired.csv','CSV_GENERATED',1,0,'UPLOADING');
insert into public."CertificateIssuanceItem"
(id,"batchId","organizationId","rowNumber","studentNumber","idempotencyKey",payload,status)
values ('ci-item-expired','ci-batch-expired','ci-institution',2,'STU-002',repeat('b',64),
'{"studentName":"Second Student","studentNumber":"STU-002"}'::jsonb,'STAGED');
update public."CertificateIssuanceItem" set status='QUEUED' where id='ci-item-expired';
update public."CertificateIssuanceBatch" set status='QUEUED',"queuedItems"=1 where id='ci-batch-expired';

do $$
declare result jsonb; item_status text; batch_status text; failed integer;
begin
  result:=public.claim_next_certificate_issuance_item('22222222-2222-4222-8222-222222222222');
  if coalesce((result->>'claimed')::boolean,false) is not true then
    raise exception 'Expected second issuance item to be claimed';
  end if;
  update public."CertificateIssuanceItem"
    set "leasedAt"=now()-interval '11 minutes'
    where id='ci-item-expired';
  result:=public.claim_next_certificate_issuance_item('33333333-3333-4333-8333-333333333333');
  if coalesce((result->>'claimed')::boolean,false) is not false then
    raise exception 'Expired uncertain item must not be reissued automatically';
  end if;
  select status into item_status from public."CertificateIssuanceItem" where id='ci-item-expired';
  select status,"failedItems" into batch_status,failed from public."CertificateIssuanceBatch" where id='ci-batch-expired';
  if item_status<>'NEEDS_REVIEW' or batch_status<>'PARTIAL' or failed<>1 then
    raise exception 'Expired lease reconciliation failed: item %, batch %, failed %',item_status,batch_status,failed;
  end if;
end $$;
