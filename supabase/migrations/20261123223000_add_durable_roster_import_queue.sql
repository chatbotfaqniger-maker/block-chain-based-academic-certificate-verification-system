-- Durable institutional roster import built on VERITY's existing StudentRoster
-- and StudentRosterImport tables. This intentionally does not recreate or replace
-- the authoritative student identity registry.
ALTER TABLE public."StudentRoster"
  ADD COLUMN IF NOT EXISTS qualification text,
  ADD COLUMN IF NOT EXISTS classification text,
  ADD COLUMN IF NOT EXISTS "awardDate" date;

ALTER TABLE public."StudentRosterImport"
  ADD COLUMN IF NOT EXISTS "duplicateRows" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "totalChunks" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "processedChunks" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "failedChunks" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'COMPLETED',
  ADD COLUMN IF NOT EXISTS "errorSummary" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "updatedAt" timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "completedAt" timestamptz;

ALTER TABLE public."StudentRosterImport"
  DROP CONSTRAINT IF EXISTS "StudentRosterImport_status_check",
  DROP CONSTRAINT IF EXISTS "StudentRosterImport_total_rows_cap",
  DROP CONSTRAINT IF EXISTS "StudentRosterImport_total_chunks_cap",
  DROP CONSTRAINT IF EXISTS "StudentRosterImport_chunk_count_matches_rows",
  DROP CONSTRAINT IF EXISTS "StudentRosterImport_rejected_lte_total",
  DROP CONSTRAINT IF EXISTS "StudentRosterImport_processed_lte_total_chunks",
  DROP CONSTRAINT IF EXISTS "StudentRosterImport_failed_lte_processed",
  DROP CONSTRAINT IF EXISTS "StudentRosterImport_result_rows_lte_valid",
  DROP CONSTRAINT IF EXISTS "StudentRosterImport_error_summary_shape";

ALTER TABLE public."StudentRosterImport"
  ADD CONSTRAINT "StudentRosterImport_status_check"
    CHECK (status IN ('UPLOADING','QUEUED','PROCESSING','COMPLETED','PARTIAL','FAILED')),
  ADD CONSTRAINT "StudentRosterImport_total_rows_cap"
    CHECK ("totalRows" BETWEEN 0 AND 50000),
  ADD CONSTRAINT "StudentRosterImport_total_chunks_cap"
    CHECK ("totalChunks" BETWEEN 0 AND 500),
  ADD CONSTRAINT "StudentRosterImport_rejected_lte_total"
    CHECK ("rejectedRows" <= "totalRows"),
  ADD CONSTRAINT "StudentRosterImport_processed_lte_total_chunks"
    CHECK ("processedChunks" <= "totalChunks"),
  ADD CONSTRAINT "StudentRosterImport_failed_lte_processed"
    CHECK ("failedChunks" <= "processedChunks"),
  ADD CONSTRAINT "StudentRosterImport_result_rows_lte_valid"
    CHECK ("insertedRows" + "duplicateRows" <= "totalRows" - "rejectedRows"),
  ADD CONSTRAINT "StudentRosterImport_chunk_count_matches_rows"
    CHECK (
      (status='COMPLETED' AND "totalChunks"=0)
      OR "totalChunks"=ceil(("totalRows"-"rejectedRows")::numeric/100)::integer
    ),
  ADD CONSTRAINT "StudentRosterImport_error_summary_shape"
    CHECK (jsonb_typeof("errorSummary")='array' AND jsonb_array_length("errorSummary")<=50);

ALTER TABLE public."StudentRoster"
  DROP CONSTRAINT IF EXISTS "StudentRoster_qualification_length",
  DROP CONSTRAINT IF EXISTS "StudentRoster_classification_length";
ALTER TABLE public."StudentRoster"
  ADD CONSTRAINT "StudentRoster_qualification_length"
    CHECK (qualification IS NULL OR char_length(btrim(qualification)) BETWEEN 2 AND 180),
  ADD CONSTRAINT "StudentRoster_classification_length"
    CHECK (classification IS NULL OR char_length(btrim(classification))<=100);

CREATE INDEX IF NOT EXISTS "StudentRosterImport_org_created_idx"
  ON public."StudentRosterImport"("organizationId","createdAt" DESC);
CREATE INDEX IF NOT EXISTS "StudentRosterImport_status_created_idx"
  ON public."StudentRosterImport"(status,"createdAt");
 
CREATE TABLE IF NOT EXISTS public."StudentImportChunk" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "batchId" text NOT NULL REFERENCES public."StudentRosterImport"(id) ON DELETE CASCADE,
  "organizationId" text NOT NULL REFERENCES public."Organization"(id) ON DELETE CASCADE,
  "chunkIndex" integer NOT NULL CHECK ("chunkIndex">=0),
  rows jsonb NOT NULL CHECK (jsonb_typeof(rows)='array' AND jsonb_array_length(rows) BETWEEN 1 AND 100),
  "contentHash" text NOT NULL CHECK ("contentHash" ~ '^[a-f0-9]{64}$'),
  "createdBy" text NOT NULL REFERENCES public."User"(id),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','COMPLETED','FAILED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0),
  "errorMessage" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "processedAt" timestamptz,
  CONSTRAINT "StudentImportChunk_batch_index_unique" UNIQUE ("batchId","chunkIndex")
);
CREATE INDEX IF NOT EXISTS "StudentImportChunk_pending_idx"
  ON public."StudentImportChunk"("createdAt","batchId","chunkIndex") WHERE status='PENDING';
ALTER TABLE public."StudentImportChunk" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS verity_student_import_chunk_roster_read ON public."StudentImportChunk";
CREATE POLICY verity_student_import_chunk_roster_read
  ON public."StudentImportChunk" FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public."Organization" o
      WHERE o.id="StudentImportChunk"."organizationId"
        AND o.type='INSTITUTION'
        AND (
          o."ownerId"=(SELECT auth.uid())::text
          OR EXISTS (
            SELECT 1 FROM public."InstitutionICTStaff" i
            WHERE i."organizationId"=o.id
              AND i."userId"=(SELECT auth.uid())::text
              AND i.status='ACTIVE'
              AND 'roster:manage'=ANY(i.permissions)
          )
        )
    )
    OR (SELECT private.is_admin())
  );

DROP POLICY IF EXISTS verity_student_import_chunk_roster_insert ON public."StudentImportChunk";
CREATE POLICY verity_student_import_chunk_roster_insert
  ON public."StudentImportChunk" FOR INSERT TO authenticated
  WITH CHECK (
    "createdBy"=(SELECT auth.uid())::text
    AND status='PENDING' AND attempts=0
    AND "errorMessage" IS NULL AND "processedAt" IS NULL
    AND EXISTS (
      SELECT 1
      FROM public."StudentRosterImport" b
      JOIN public."Organization" o ON o.id=b."organizationId"
      WHERE b.id="StudentImportChunk"."batchId"
        AND b."organizationId"="StudentImportChunk"."organizationId"
        AND b."uploadedBy"=(SELECT auth.uid())::text
        AND b.status='UPLOADING'
        AND "StudentImportChunk"."chunkIndex"<b."totalChunks"
        AND jsonb_array_length("StudentImportChunk".rows)
          =least(100,b."totalRows"-b."rejectedRows"-("StudentImportChunk"."chunkIndex"*100))
        AND o.type='INSTITUTION' AND o.status='APPROVED'
        AND (
          o."ownerId"=(SELECT auth.uid())::text
          OR EXISTS (
            SELECT 1 FROM public."InstitutionICTStaff" i
            WHERE i."organizationId"=o.id
              AND i."userId"=(SELECT auth.uid())::text
              AND i.status='ACTIVE'
              AND 'roster:manage'=ANY(i.permissions)
          )
        )
    )
  );

DROP POLICY IF EXISTS verity_student_import_roster_queue_update ON public."StudentRosterImport";
CREATE POLICY verity_student_import_roster_queue_update
  ON public."StudentRosterImport" FOR UPDATE TO authenticated
  USING (
    status='UPLOADING'
    AND EXISTS (
      SELECT 1 FROM public."Organization" o
      WHERE o.id="StudentRosterImport"."organizationId"
        AND o.type='INSTITUTION' AND o.status='APPROVED'
        AND (
          o."ownerId"=(SELECT auth.uid())::text
          OR EXISTS (
            SELECT 1 FROM public."InstitutionICTStaff" i
            WHERE i."organizationId"=o.id
              AND i."userId"=(SELECT auth.uid())::text
              AND i.status='ACTIVE'
              AND 'roster:manage'=ANY(i.permissions)
          )
        )
    )
  )
  WITH CHECK (
    status='QUEUED'
    AND "totalChunks">0
    AND "processedChunks"=0
    AND "failedChunks"=0
    AND "insertedRows"=0
    AND "duplicateRows"=0
    AND "completedAt" IS NULL
    AND EXISTS (
      SELECT 1 FROM public."Organization" o
      WHERE o.id="StudentRosterImport"."organizationId"
        AND o.type='INSTITUTION' AND o.status='APPROVED'
        AND (
          o."ownerId"=(SELECT auth.uid())::text
          OR EXISTS (
            SELECT 1 FROM public."InstitutionICTStaff" i
            WHERE i."organizationId"=o.id
              AND i."userId"=(SELECT auth.uid())::text
              AND i.status='ACTIVE'
              AND 'roster:manage'=ANY(i.permissions)
          )
        )
    )
  );

-- Client users can read/insert their own import logs and make only the single
-- UPLOADING -> QUEUED transition. Processing counters remain server-only.
REVOKE ALL ON TABLE public."StudentRosterImport" FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public."StudentRosterImport" TO authenticated;
GRANT UPDATE(status,"updatedAt") ON TABLE public."StudentRosterImport" TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public."StudentRosterImport" TO service_role;

REVOKE ALL ON TABLE public."StudentImportChunk" FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public."StudentImportChunk" TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public."StudentImportChunk" TO service_role;

-- The worker is a single-transaction, SKIP LOCKED consumer. A process crash
-- rolls back the chunk transaction, leaving it available for another worker.
CREATE OR REPLACE FUNCTION public.process_next_student_import_chunk()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=''
AS $function$
DECLARE
  v_chunk public."StudentImportChunk"%ROWTYPE;
  v_org_status text;
  v_inserted integer:=0;
  v_total integer:=0;
  v_processed integer:=0;
  v_inserted_total integer:=0;
  v_duplicate_total integer:=0;
  v_failed_total integer:=0;
  v_rejected integer:=0;
  v_final_status text:='PROCESSING';
  v_error text;
BEGIN
  SELECT c,o.status INTO v_chunk,v_org_status
  FROM public."StudentImportChunk" c
  JOIN public."StudentRosterImport" b ON b.id=c."batchId"
  JOIN public."Organization" o ON o.id=c."organizationId"
  WHERE c.status='PENDING' AND b.status IN ('QUEUED','PROCESSING')
  ORDER BY c."createdAt",c."chunkIndex"
  FOR UPDATE OF c SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('processed',false);
  END IF;

  UPDATE public."StudentImportChunk"
    SET attempts=attempts+1 WHERE id=v_chunk.id;
  v_total:=jsonb_array_length(v_chunk.rows);

  IF v_org_status<>'APPROVED' THEN
    v_error:='Institution approval is no longer active; this import cannot be processed.';
    UPDATE public."StudentImportChunk"
      SET status='FAILED',"processedAt"=now(),"errorMessage"=v_error
      WHERE id=v_chunk.id;
    UPDATE public."StudentRosterImport"
      SET "failedChunks"="failedChunks"+1,
          "processedChunks"="processedChunks"+1,
          "errorSummary"="errorSummary"||jsonb_build_array(jsonb_build_object('chunkIndex',v_chunk."chunkIndex",'message',v_error)),
          status='FAILED',"completedAt"=now(),"updatedAt"=now()
      WHERE id=v_chunk."batchId";
    RETURN jsonb_build_object('processed',true,'failed',true,'batchId',v_chunk."batchId",'chunkIndex',v_chunk."chunkIndex",'error',v_error,'status','FAILED');
  END IF;

  UPDATE public."StudentRosterImport"
    SET status='PROCESSING',"updatedAt"=now()
    WHERE id=v_chunk."batchId" AND status='QUEUED';

  BEGIN
    IF EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(v_chunk.rows) AS x(
        "studentNumber" text,"fullName" text,email text,faculty text,
        department text,programme text,qualification text,classification text,
        "awardDate" text,"academicSession" text
      )
      WHERE char_length(btrim(coalesce(x."studentNumber",''))) NOT BETWEEN 2 AND 80
        OR char_length(btrim(coalesce(x."fullName",''))) NOT BETWEEN 2 AND 160
        OR char_length(btrim(coalesce(x.faculty,''))) NOT BETWEEN 2 AND 160
        OR char_length(btrim(coalesce(x.department,''))) NOT BETWEEN 2 AND 160
        OR char_length(btrim(coalesce(x.programme,''))) NOT BETWEEN 2 AND 180
        OR char_length(btrim(coalesce(x.qualification,''))) NOT BETWEEN 2 AND 180
        OR (nullif(trim(x.email),'') IS NOT NULL AND (char_length(trim(x.email))>254 OR trim(x.email)!~*'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
        OR (nullif(trim(x.classification),'') IS NOT NULL AND char_length(trim(x.classification))>100)
        OR (nullif(trim(x."academicSession"),'') IS NOT NULL AND char_length(trim(x."academicSession"))>80)
        OR (nullif(trim(x."awardDate"),'') IS NOT NULL AND trim(x."awardDate")!~'^\d{4}-\d{2}-\d{2}$')
    ) THEN
      RAISE EXCEPTION 'The staged chunk contains invalid student or academic details.';
    END IF;

    INSERT INTO public."StudentRoster" (
      id,"organizationId","studentNumber","normalizedStudentNumber","fullName",
      "institutionalEmail",faculty,department,programme,"academicSession",
      qualification,classification,"awardDate",status,"claimedUserId","claimedAt",
      "importBatchId","createdBy","createdAt","updatedAt"
    )
    SELECT
      gen_random_uuid()::text,
      v_chunk."organizationId",
      trim(x."studentNumber"),
      upper(regexp_replace(trim(x."studentNumber"),'[[:space:]]+','','g')),
      trim(x."fullName"),
      nullif(lower(trim(x.email)),''),
      trim(x.faculty),
      trim(x.department),
      trim(x.programme),
      nullif(trim(x."academicSession"),''),
      trim(x.qualification),
      nullif(trim(x.classification),''),
      CASE WHEN nullif(trim(x."awardDate"),'') IS NULL THEN NULL ELSE trim(x."awardDate")::date END,
      'ELIGIBLE',NULL,NULL,
      v_chunk."batchId",
      v_chunk."createdBy",
      now(),now()
    FROM jsonb_to_recordset(v_chunk.rows) AS x(
      "studentNumber" text,"fullName" text,email text,faculty text,
      department text,programme text,qualification text,classification text,
      "awardDate" text,"academicSession" text
    )
    ON CONFLICT ("organizationId","normalizedStudentNumber") DO NOTHING;

    GET DIAGNOSTICS v_inserted=ROW_COUNT;

    UPDATE public."StudentImportChunk"
      SET status='COMPLETED',"processedAt"=now(),"errorMessage"=NULL
      WHERE id=v_chunk.id;

    UPDATE public."StudentRosterImport"
      SET "insertedRows"="insertedRows"+v_inserted,
          "duplicateRows"="duplicateRows"+(v_total-v_inserted),
          "processedChunks"="processedChunks"+1,
          status=CASE
            WHEN "processedChunks"+1>="totalChunks" THEN
              CASE WHEN "rejectedRows">0 OR "failedChunks">0 OR "duplicateRows"+(v_total-v_inserted)>0
                THEN 'PARTIAL' ELSE 'COMPLETED' END
            ELSE 'PROCESSING'
          END,
          "completedAt"=CASE WHEN "processedChunks"+1>="totalChunks" THEN now() ELSE NULL END,
          "updatedAt"=now()
      WHERE id=v_chunk."batchId"
      RETURNING "processedChunks","insertedRows","duplicateRows","failedChunks","rejectedRows",status
        INTO v_processed,v_inserted_total,v_duplicate_total,v_failed_total,v_rejected,v_final_status;

    RETURN jsonb_build_object(
      'processed',true,'batchId',v_chunk."batchId",'chunkIndex',v_chunk."chunkIndex",
      'inserted',v_inserted,'duplicates',v_total-v_inserted,
      'processedChunks',v_processed,'insertedRows',v_inserted_total,
      'duplicateRows',v_duplicate_total,'failedChunks',v_failed_total,
      'rejectedRows',v_rejected,'status',v_final_status
    );
  EXCEPTION WHEN OTHERS THEN
    v_error:=left(SQLERRM,300);
    UPDATE public."StudentImportChunk"
      SET status='FAILED',"processedAt"=now(),"errorMessage"=v_error
      WHERE id=v_chunk.id;
    UPDATE public."StudentRosterImport"
      SET "failedChunks"="failedChunks"+1,
          "processedChunks"="processedChunks"+1,
          "errorSummary"=CASE WHEN jsonb_array_length("errorSummary")<50
            THEN "errorSummary"||jsonb_build_array(jsonb_build_object('chunkIndex',v_chunk."chunkIndex",'message',v_error))
            ELSE "errorSummary" END,
          status=CASE WHEN "processedChunks"+1>="totalChunks" THEN 'PARTIAL' ELSE 'PROCESSING' END,
          "completedAt"=CASE WHEN "processedChunks"+1>="totalChunks" THEN now() ELSE NULL END,
          "updatedAt"=now()
      WHERE id=v_chunk."batchId"
      RETURNING "processedChunks","insertedRows","duplicateRows","failedChunks","rejectedRows",status
        INTO v_processed,v_inserted_total,v_duplicate_total,v_failed_total,v_rejected,v_final_status;
    RETURN jsonb_build_object(
      'processed',true,'failed',true,'batchId',v_chunk."batchId",
      'chunkIndex',v_chunk."chunkIndex",'error',v_error,
      'processedChunks',v_processed,'insertedRows',v_inserted_total,
      'duplicateRows',v_duplicate_total,'failedChunks',v_failed_total,
      'rejectedRows',v_rejected,'status',v_final_status
    );
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.process_next_student_import_chunk() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.process_next_student_import_chunk() TO service_role;
