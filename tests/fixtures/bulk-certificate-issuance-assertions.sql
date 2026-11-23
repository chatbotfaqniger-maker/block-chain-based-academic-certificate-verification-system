\set ON_ERROR_STOP on
INSERT INTO public."User"(id) VALUES ('11111111-1111-4111-8111-111111111111');
INSERT INTO public."Organization"(id,"ownerId",type,status)
VALUES ('org-bulk-test','11111111-1111-4111-8111-111111111111','INSTITUTION','APPROVED');

SET ROLE service_role;
INSERT INTO public."CertificateIssuanceBatch"(id,"organizationId","createdBy","fileName",method,"totalItems")
VALUES ('batch-main','org-bulk-test','11111111-1111-4111-8111-111111111111','cohort.csv','CSV_GENERATED',2);
INSERT INTO public."CertificateIssuanceItem"(id,"batchId","organizationId","rowNumber","studentNumber","idempotencyKey",payload,"documentStoragePath","documentName","documentSha256")
VALUES
 ('item-main-1','batch-main','org-bulk-test',2,'2021CS001',repeat('a',64),
  '{"studentName":"Test Student One","studentNumber":"2021CS001"}',
  'bulk-staging/org-bulk-test/batch-main/item-main-1.pdf','one.pdf',repeat('b',64)),
 ('item-main-2','batch-main','org-bulk-test',3,'2021CS002',repeat('c',64),
  '{"studentName":"Test Student Two","studentNumber":"2021CS002"}',
  'bulk-staging/org-bulk-test/batch-main/item-main-2.pdf','two.pdf',repeat('d',64));
SELECT public.queue_certificate_issuance_batch('batch-main','11111111-1111-4111-8111-111111111111');
DO $$
DECLARE r jsonb; item_id text; lease text:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
BEGIN
  r:=public.claim_next_certificate_issuance_item(lease);
  IF coalesce((r->>'claimed')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'Expected first claim'; END IF;
  item_id:=r->'item'->>'id';
  IF item_id<>'item-main-1' THEN RAISE EXCEPTION 'Unexpected first claimed item: %',item_id; END IF;
  INSERT INTO public."Certificate"(id,"certificateId","bulkIssuanceItemId")
  VALUES ('cert-main-1','VRT-2026-BULK-001',item_id);
  PERFORM public.finish_certificate_issuance_item(item_id,lease,'RETRY','VRT-2026-BULK-001','STORAGE_503','Temporary private storage outage');
  IF (SELECT status FROM public."CertificateIssuanceItem" WHERE id=item_id)<>'QUEUED' THEN RAISE EXCEPTION 'Retry did not return item to queue'; END IF;
  UPDATE public."CertificateIssuanceItem" SET "nextAttemptAt"=now() WHERE id=item_id;
  r:=public.claim_next_certificate_issuance_item('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  IF coalesce((r->>'claimed')::boolean,false) IS NOT TRUE OR r->'item'->>'id'<>item_id THEN RAISE EXCEPTION 'Expected retry claim'; END IF;
  PERFORM public.finish_certificate_issuance_item(item_id,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','ISSUED','VRT-2026-BULK-001',NULL,NULL);
  r:=public.claim_next_certificate_issuance_item('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  IF coalesce((r->>'claimed')::boolean,false) IS NOT TRUE OR r->'item'->>'id'<>'item-main-2' THEN RAISE EXCEPTION 'Expected second item claim'; END IF;
  PERFORM public.finish_certificate_issuance_item('item-main-2','cccccccc-cccc-4ccc-8ccc-cccccccccccc','FAILED',NULL,'INVALID_DATA','Deliberate fixture failure');
  IF (SELECT status FROM public."CertificateIssuanceBatch" WHERE id='batch-main')<>'PARTIAL' THEN RAISE EXCEPTION 'Batch should be PARTIAL'; END IF;
  IF (SELECT "issuedItems" FROM public."CertificateIssuanceBatch" WHERE id='batch-main')<>1 THEN RAISE EXCEPTION 'Issued count incorrect'; END IF;
  IF (SELECT "failedItems" FROM public."CertificateIssuanceBatch" WHERE id='batch-main')<>1 THEN RAISE EXCEPTION 'Failed count incorrect'; END IF;
END $$;

INSERT INTO public."CertificateIssuanceBatch"(id,"organizationId","createdBy","fileName",method,"totalItems")
VALUES ('batch-reconcile','org-bulk-test','11111111-1111-4111-8111-111111111111','one.csv','CSV_GENERATED',1);
INSERT INTO public."CertificateIssuanceItem"(id,"batchId","organizationId","rowNumber","studentNumber","idempotencyKey",payload,"documentStoragePath","documentName","documentSha256")
VALUES ('item-reconcile','batch-reconcile','org-bulk-test',2,'2021CS003',repeat('e',64),
  '{"studentName":"Test Student Three","studentNumber":"2021CS003"}',
  'bulk-staging/org-bulk-test/batch-reconcile/item-reconcile.pdf','three.pdf',repeat('f',64));
SELECT public.queue_certificate_issuance_batch('batch-reconcile','11111111-1111-4111-8111-111111111111');
DO $$
DECLARE r jsonb;
BEGIN
  r:=public.claim_next_certificate_issuance_item('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  IF coalesce((r->>'claimed')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'Expected reconciliation claim'; END IF;
  INSERT INTO public."Certificate"(id,"certificateId","bulkIssuanceItemId")
  VALUES ('cert-reconcile','VRT-2026-BULK-003','item-reconcile');
  UPDATE public."CertificateIssuanceItem"
    SET "leasedAt"=now()-interval '11 minutes'
    WHERE id='item-reconcile';
  r:=public.claim_next_certificate_issuance_item('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
  IF coalesce((r->>'claimed')::boolean,false) IS TRUE THEN RAISE EXCEPTION 'Expired lease must not be blindly reclaimed'; END IF;
  IF (SELECT status FROM public."CertificateIssuanceItem" WHERE id='item-reconcile')<>'NEEDS_REVIEW' THEN RAISE EXCEPTION 'Expired item should require reconciliation'; END IF;
  PERFORM public.reconcile_certificate_issuance_item('item-reconcile',false,NULL);
  IF (SELECT status FROM public."CertificateIssuanceItem" WHERE id='item-reconcile')<>'ISSUED' THEN RAISE EXCEPTION 'Certificate-backed lease was not reconciled'; END IF;
  IF (SELECT status FROM public."CertificateIssuanceBatch" WHERE id='batch-reconcile')<>'COMPLETED' THEN RAISE EXCEPTION 'Reconciled batch should be completed'; END IF;
END $$;
RESET ROLE;

DO $$
BEGIN
  IF has_function_privilege('anon','public.claim_next_certificate_issuance_item(text)','EXECUTE') THEN RAISE EXCEPTION 'anon must not claim issuance jobs'; END IF;
  IF has_function_privilege('authenticated','public.claim_next_certificate_issuance_item(text)','EXECUTE') THEN RAISE EXCEPTION 'authenticated must not claim issuance jobs'; END IF;
  IF NOT has_function_privilege('service_role','public.claim_next_certificate_issuance_item(text)','EXECUTE') THEN RAISE EXCEPTION 'service_role must claim issuance jobs'; END IF;
  IF has_function_privilege('authenticated','public.queue_certificate_issuance_batch(text,text)','EXECUTE') THEN RAISE EXCEPTION 'authenticated must not queue batches directly'; END IF;
  IF NOT has_function_privilege('service_role','public.reconcile_certificate_issuance_item(text,boolean,text)','EXECUTE') THEN RAISE EXCEPTION 'service_role must reconcile expired items'; END IF;
  IF has_table_privilege('anon','public."CertificateIssuanceItem"','SELECT') THEN RAISE EXCEPTION 'anon must not read issuance payloads'; END IF;
  IF has_table_privilege('authenticated','public."CertificateIssuanceItem"','INSERT') THEN RAISE EXCEPTION 'authenticated must not write issuance payloads directly'; END IF;
END $$;
