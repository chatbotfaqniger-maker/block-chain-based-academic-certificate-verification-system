INSERT INTO public."User"(id,"fullName",email,role)
VALUES ('10000000-0000-4000-8000-000000000001','ICT Test User','ict@example.test','GRADUATE');
INSERT INTO public."Organization"(id,name,type,status,"ownerId")
VALUES ('org-test','Test Institution','INSTITUTION','APPROVED','20000000-0000-4000-8000-000000000002');
INSERT INTO public."InstitutionICTStaff"(id,"organizationId","userId",permissions,status)
VALUES ('ict-test','org-test','10000000-0000-4000-8000-000000000001',ARRAY['roster:manage'],'ACTIVE');

SET request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';
SET ROLE authenticated;
INSERT INTO public."StudentRosterImport"(id,"organizationId","uploadedBy","fileName","totalRows","rejectedRows","totalChunks",status)
VALUES ('batch-test','org-test','10000000-0000-4000-8000-000000000001','test-roster.csv',2,0,1,'UPLOADING');
INSERT INTO public."StudentImportChunk"(id,"batchId","organizationId","chunkIndex",rows,"contentHash","createdBy")
VALUES (
  'chunk-test','batch-test','org-test',0,
  '[{"studentNumber":"AB 123","fullName":"Ada Example","email":"ada@example.test","faculty":"Science","department":"Computer Science","programme":"Computer Science","qualification":"BSc Computer Science","classification":"Second Class Upper","awardDate":"2026-10-15","academicSession":"2025/2026"},{"studentNumber":"AB123","fullName":"Duplicate Example","email":"duplicate@example.test","faculty":"Science","department":"Computer Science","programme":"Computer Science","qualification":"BSc Computer Science","classification":"Second Class Upper","awardDate":"2026-10-15","academicSession":"2025/2026"}]'::jsonb,
  repeat('a',64),
  '10000000-0000-4000-8000-000000000001'
);
UPDATE public."StudentRosterImport" SET status='QUEUED', "updatedAt"=now() WHERE id='batch-test';
RESET ROLE;

SET ROLE service_role;
SELECT public.process_next_student_import_chunk();
SELECT public.process_next_student_import_chunk();
RESET ROLE;

DO $$
DECLARE v_count integer; v_batch public."StudentRosterImport"%ROWTYPE; v_student public."StudentRoster"%ROWTYPE;
BEGIN
  SELECT count(*) INTO v_count FROM public."StudentRoster" WHERE "organizationId"='org-test';
  IF v_count<>1 THEN RAISE EXCEPTION 'Expected one normalized student roster record, got %',v_count; END IF;
  SELECT * INTO v_student FROM public."StudentRoster" WHERE "organizationId"='org-test';
  IF v_student."normalizedStudentNumber"<>'AB123' THEN RAISE EXCEPTION 'Student number normalization failed'; END IF;
  IF v_student."institutionalEmail"<>'ada@example.test' THEN RAISE EXCEPTION 'Institutional email mapping failed'; END IF;
  IF v_student.status<>'ELIGIBLE' THEN RAISE EXCEPTION 'Imported roster must be eligible for the existing activation workflow'; END IF;
  IF v_student."importBatchId"<>'batch-test' THEN RAISE EXCEPTION 'Import batch reference was not stored'; END IF;
  SELECT * INTO v_batch FROM public."StudentRosterImport" WHERE id='batch-test';
  IF v_batch."insertedRows"<>1 OR v_batch."duplicateRows"<>1 OR v_batch."processedChunks"<>1 OR v_batch.status<>'PARTIAL' THEN
    RAISE EXCEPTION 'Batch accounting/status mismatch: inserted %, duplicate %, processed %, status %',v_batch."insertedRows",v_batch."duplicateRows",v_batch."processedChunks",v_batch.status;
  END IF;
  IF has_function_privilege('anon','public.process_next_student_import_chunk()','EXECUTE') THEN RAISE EXCEPTION 'anon can run import worker'; END IF;
  IF has_function_privilege('authenticated','public.process_next_student_import_chunk()','EXECUTE') THEN RAISE EXCEPTION 'authenticated can run import worker'; END IF;
  IF NOT has_function_privilege('service_role','public.process_next_student_import_chunk()','EXECUTE') THEN RAISE EXCEPTION 'service_role cannot run import worker'; END IF;
  IF has_table_privilege('anon','public."StudentImportChunk"','SELECT') THEN RAISE EXCEPTION 'anon can read private import chunks'; END IF;
  IF has_column_privilege('authenticated','public."StudentRosterImport"','insertedRows','UPDATE') THEN RAISE EXCEPTION 'authenticated can forge import counters'; END IF;
END $$;
