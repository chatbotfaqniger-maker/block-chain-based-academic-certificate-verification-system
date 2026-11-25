-- Verify uploader-owned, resumable draft persistence and isolation.
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='StudentRosterImportDraft') THEN
   RAISE EXCEPTION 'Persistent roster draft metadata table is missing';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='StudentRosterImportDraftChunk') THEN
   RAISE EXCEPTION 'Persistent roster draft chunk table is missing';
 END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public."StudentRosterImportDraft"'::regclass) THEN
   RAISE EXCEPTION 'RLS is not enabled for roster drafts';
 END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public."StudentRosterImportDraftChunk"'::regclass) THEN
   RAISE EXCEPTION 'RLS is not enabled for roster draft chunks';
 END IF;
 IF has_table_privilege('anon','public."StudentRosterImportDraft"','SELECT') THEN
   RAISE EXCEPTION 'Anonymous users can read persistent roster drafts';
 END IF;
END $$;

SET request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';
SET request.jwt.claim.role='authenticated';
SET ROLE authenticated;
INSERT INTO public."StudentRosterImportDraft"(
 id,"organizationId","createdBy","fileName","totalRows","totalChunks",status
) VALUES (
 '30000000-0000-4000-8000-000000000001','org-integrity',
 '10000000-0000-4000-8000-000000000001','semester-roster.xlsx',2,1,'DRAFT'
);
INSERT INTO public."StudentRosterImportDraftChunk"(
 "draftId","organizationId","chunkIndex",rows,"contentHash","updatedBy"
) VALUES (
 '30000000-0000-4000-8000-000000000001','org-integrity',0,
 '[{"rowNumber":2,"studentNumber":"CS/002","fullName":"Grace Example","email":"grace@example.test","faculty":"Science","department":"Computer Science","programme":"Computer Science","qualification":"BSc","classification":"","awardDate":null,"academicSession":"2025/2026"},{"rowNumber":3,"studentNumber":"CS/003","fullName":"Alan Example","email":"","faculty":"Science","department":"Computer Science","programme":"Computer Science","qualification":"BSc","classification":"","awardDate":null,"academicSession":"2025/2026"}]'::jsonb,
 repeat('a',64),'10000000-0000-4000-8000-000000000001'
);
DO $$
BEGIN
 IF (SELECT count(*) FROM public."StudentRosterImportDraftChunk"
     WHERE "draftId"='30000000-0000-4000-8000-000000000001')<>1 THEN
   RAISE EXCEPTION 'Uploader cannot read back its saved draft chunk';
 END IF;
 UPDATE public."StudentRosterImportDraftChunk"
 SET "contentHash"=repeat('b',64),"updatedAt"=now()
 WHERE "draftId"='30000000-0000-4000-8000-000000000001' AND "chunkIndex"=0;
 IF NOT FOUND THEN RAISE EXCEPTION 'Uploader cannot update a saved draft chunk'; END IF;
END $$;
RESET ROLE;

-- Another authorized issuer user cannot read or edit the uploader's draft.
SET request.jwt.claim.sub='20000000-0000-4000-8000-000000000002';
SET request.jwt.claim.role='authenticated';
SET ROLE authenticated;
DO $$
BEGIN
 IF (SELECT count(*) FROM public."StudentRosterImportDraft"
     WHERE id='30000000-0000-4000-8000-000000000001')<>0 THEN
   RAISE EXCEPTION 'A different issuer account can read another uploader draft';
 END IF;
END $$;
RESET ROLE;

-- Drafts are not roster import batches and therefore cannot be consumed by the worker.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM public."StudentRosterImport" WHERE id='30000000-0000-4000-8000-000000000001') THEN
   RAISE EXCEPTION 'A spreadsheet draft was incorrectly inserted as a processable import batch';
 END IF;
END $$;

-- Uploader can discard a draft; chunk data is removed by FK cascade.
SET request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';
SET request.jwt.claim.role='authenticated';
SET ROLE authenticated;
DELETE FROM public."StudentRosterImportDraft"
WHERE id='30000000-0000-4000-8000-000000000001';
RESET ROLE;
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM public."StudentRosterImportDraftChunk"
            WHERE "draftId"='30000000-0000-4000-8000-000000000001') THEN
   RAISE EXCEPTION 'Deleting a draft did not cascade to its saved chunks';
 END IF;
END $$;
