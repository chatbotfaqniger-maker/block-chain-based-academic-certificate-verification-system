INSERT INTO public."User"(id,"fullName",email,role) VALUES
 ('10000000-0000-4000-8000-000000000001','ICT Officer','ict@verity.test','GRADUATE'),
 ('20000000-0000-4000-8000-000000000002','Institution Owner','owner@verity.test','EMPLOYER');
INSERT INTO public."Organization"(id,name,type,status,"ownerId")
VALUES ('org-integrity','Integrity Test Institution','INSTITUTION','APPROVED','20000000-0000-4000-8000-000000000002');
INSERT INTO public."InstitutionICTStaff"(id,"organizationId","userId",permissions,status)
VALUES ('ict-integrity','org-integrity','10000000-0000-4000-8000-000000000001',ARRAY['roster:manage'],'ACTIVE');

-- ICT can stage and submit, but cannot move the batch into the worker queue.
SET request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';
SET request.jwt.claim.role='authenticated';
SET ROLE authenticated;
INSERT INTO public."StudentRosterImport"(id,"organizationId","uploadedBy","fileName","totalRows","rejectedRows","totalChunks",status)
VALUES ('batch-integrity','org-integrity','10000000-0000-4000-8000-000000000001','approved-roster.csv',1,0,1,'UPLOADING');
INSERT INTO public."StudentImportChunk"(id,"batchId","organizationId","chunkIndex",rows,"contentHash","createdBy")
VALUES ('chunk-integrity','batch-integrity','org-integrity',0,
 '[{"studentNumber":"CS/001","fullName":"Ada Example","faculty":"Science","department":"Computer Science","programme":"Computer Science","qualification":"BSc Computer Science","classification":"First Class","awardDate":"2026-10-15","academicSession":"2025/2026"}]'::jsonb,
 repeat('a',64),'10000000-0000-4000-8000-000000000001');
DO $ BEGIN
 BEGIN
   UPDATE public."StudentRosterImport" SET status='QUEUED' WHERE id='batch-integrity';
 EXCEPTION WHEN OTHERS THEN
   NULL; -- Expected denial: ICT cannot queue an import.
 END;
 IF (SELECT status FROM public."StudentRosterImport" WHERE id='batch-integrity') <> 'UPLOADING' THEN
   RAISE EXCEPTION 'ICT must not be able to queue an import without owner approval';
 END IF;
END $;
UPDATE public."StudentRosterImport" SET status='AWAITING_APPROVAL',"submittedAt"=now()
WHERE id='batch-integrity' AND status='UPLOADING';
RESET ROLE;

DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public."StudentRoster" WHERE "organizationId"='org-integrity') THEN
   RAISE EXCEPTION 'Roster records were committed before owner approval';
 END IF;
END $$;

-- Only the institution owner can approve the staged batch.
SET request.jwt.claim.sub='20000000-0000-4000-8000-000000000002';
SET request.jwt.claim.role='authenticated';
SET ROLE authenticated;
UPDATE public."StudentRosterImport" SET status='QUEUED',"approvedBy"='20000000-0000-4000-8000-000000000002',"approvedAt"=now()
WHERE id='batch-integrity' AND status='AWAITING_APPROVAL';
RESET ROLE;

SET request.jwt.claim.role='service_role';
SET ROLE service_role;
SELECT public.process_next_student_import_chunk();
RESET ROLE;

DO $$ BEGIN
 IF (SELECT count(*) FROM public."StudentRoster" WHERE "organizationId"='org-integrity') <> 1 THEN
   RAISE EXCEPTION 'Approved roster batch was not committed by the worker';
 END IF;
 IF (SELECT status FROM public."StudentRosterImport" WHERE id='batch-integrity') NOT IN ('COMPLETED','PARTIAL') THEN
   RAISE EXCEPTION 'Approved import did not reach a terminal processing state';
 END IF;
END $$;

-- ICT submits a correction request; owner approval applies it atomically.
SET request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';
SET request.jwt.claim.role='authenticated';
SET ROLE authenticated;
INSERT INTO public."StudentRosterCorrectionRequest"(id,"organizationId","rosterId","requestedBy","originalRecord","proposedRecord",reason)
SELECT 'roster-correction','org-integrity',r.id,'10000000-0000-4000-8000-000000000001',
 to_jsonb(r),to_jsonb(r)||'{"fullName":"Ada Corrected"}'::jsonb,'Correct official spelling from approved student evidence'
FROM public."StudentRoster" r WHERE r."organizationId"='org-integrity';
RESET ROLE;

SET request.jwt.claim.sub='20000000-0000-4000-8000-000000000002';
SET request.jwt.claim.role='authenticated';
SET ROLE authenticated;
SELECT public.verity_decide_student_roster_correction('roster-correction','APPROVED','Checked against official record');
RESET ROLE;

DO $$ BEGIN
 IF (SELECT "fullName" FROM public."StudentRoster" WHERE "organizationId"='org-integrity') <> 'Ada Corrected' THEN
   RAISE EXCEPTION 'Owner-approved correction was not applied';
 END IF;
 IF has_table_privilege('authenticated','public."StudentRoster"','UPDATE')
    OR has_table_privilege('authenticated','public."StudentRoster"','DELETE') THEN
   RAISE EXCEPTION 'Authenticated users retain direct StudentRoster mutation privileges';
 END IF;
END $$;

-- Credential correction approval never changes the original certificate row.
SET request.jwt.claim.role='service_role';
SET ROLE service_role;
INSERT INTO public."Certificate"(id,"certificateId",digest,"organizationId",status)
VALUES ('cert-original','VRT-ORIGINAL',repeat('b',64),'org-integrity','ACTIVE');
RESET ROLE;

SET request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';
SET request.jwt.claim.role='authenticated';
SET ROLE authenticated;
INSERT INTO public."CredentialCorrectionRequest"(id,"organizationId","certificateRowId","certificateId","originalDigest","proposedRecord",reason,"requestedBy")
VALUES ('credential-correction','org-integrity','cert-original','VRT-ORIGINAL',repeat('b',64),
 '{"studentName":"Ada Corrected"}'::jsonb,'Correct award record based on official Senate evidence','10000000-0000-4000-8000-000000000001');
RESET ROLE;

SET request.jwt.claim.sub='20000000-0000-4000-8000-000000000002';
SET request.jwt.claim.role='authenticated';
SET ROLE authenticated;
SELECT public.verity_decide_credential_correction('credential-correction','APPROVED','Authorized separate reissuance');
RESET ROLE;

DO $$ BEGIN
 IF (SELECT digest FROM public."Certificate" WHERE id='cert-original') <> repeat('b',64)
    OR (SELECT "certificateId" FROM public."Certificate" WHERE id='cert-original') <> 'VRT-ORIGINAL' THEN
   RAISE EXCEPTION 'Credential correction approval mutated the original issued certificate';
 END IF;
END $$;

-- A replacement is linked only after a distinct credential is issued and the
-- original is separately revoked with a reason/status event.
SET request.jwt.claim.role='service_role';
SET ROLE service_role;
UPDATE public."Certificate" SET status='REVOKED' WHERE id='cert-original';
INSERT INTO public."Certificate"(id,"certificateId",digest,"organizationId",status)
VALUES ('cert-replacement','VRT-REPLACEMENT',repeat('c',64),'org-integrity','ACTIVE');
RESET ROLE;

SET request.jwt.claim.sub='20000000-0000-4000-8000-000000000002';
SET request.jwt.claim.role='authenticated';
SET ROLE authenticated;
SELECT public.verity_link_credential_replacement('credential-correction','cert-replacement');
RESET ROLE;

DO $$ BEGIN
 IF (SELECT status FROM public."CredentialCorrectionRequest" WHERE id='credential-correction') <> 'REISSUED' THEN
   RAISE EXCEPTION 'Replacement credential was not linked';
 END IF;
 IF (SELECT "replacementCertificateRowId" FROM public."CredentialCorrectionRequest" WHERE id='credential-correction') <> 'cert-replacement' THEN
   RAISE EXCEPTION 'Replacement certificate reference was not stored';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public."AuditEvent" WHERE action='CREDENTIAL_CORRECTION_REISSUED') THEN
   RAISE EXCEPTION 'Replacement linkage was not audited';
 END IF;
END $$;
