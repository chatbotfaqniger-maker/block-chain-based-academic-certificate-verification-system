-- Persistent, resumable pre-approval spreadsheet drafts for VERITY.
-- Draft data is separate from StudentRosterImport and cannot be processed by workers.
CREATE TABLE IF NOT EXISTS public."StudentRosterImportDraft" (
  id uuid PRIMARY KEY,
  "organizationId" text NOT NULL REFERENCES public."Organization"(id) ON DELETE CASCADE,
  "createdBy" text NOT NULL REFERENCES public."User"(id),
  "fileName" text NOT NULL CHECK (length("fileName") BETWEEN 1 AND 180),
  "totalRows" integer NOT NULL DEFAULT 0 CHECK ("totalRows" BETWEEN 0 AND 50000),
  "totalChunks" integer NOT NULL DEFAULT 0 CHECK ("totalChunks" BETWEEN 0 AND 500),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','CONVERTED','ABANDONED')),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "expiresAt" timestamptz NOT NULL DEFAULT (now() + interval '30 days')
);

CREATE INDEX IF NOT EXISTS "StudentRosterImportDraft_owner_updated_idx"
  ON public."StudentRosterImportDraft" ("organizationId","createdBy","updatedAt" DESC)
  WHERE status='DRAFT';

CREATE TABLE IF NOT EXISTS public."StudentRosterImportDraftChunk" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "draftId" uuid NOT NULL REFERENCES public."StudentRosterImportDraft"(id) ON DELETE CASCADE,
  "organizationId" text NOT NULL REFERENCES public."Organization"(id) ON DELETE CASCADE,
  "chunkIndex" integer NOT NULL CHECK ("chunkIndex" BETWEEN 0 AND 499),
  rows jsonb NOT NULL CHECK (jsonb_typeof(rows)='array' AND jsonb_array_length(rows) BETWEEN 1 AND 100),
  "contentHash" text NOT NULL CHECK (length("contentHash")=64),
  "updatedBy" text NOT NULL REFERENCES public."User"("id"),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("draftId","chunkIndex")
);

CREATE INDEX IF NOT EXISTS "StudentRosterImportDraftChunk_org_draft_idx"
  ON public."StudentRosterImportDraftChunk" ("organizationId","draftId","chunkIndex");

ALTER TABLE public."StudentRosterImportDraft" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."StudentRosterImportDraftChunk" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public."StudentRosterImportDraft" FROM anon, authenticated;
REVOKE ALL ON public."StudentRosterImportDraftChunk" FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."StudentRosterImportDraft" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."StudentRosterImportDraftChunk" TO authenticated;

DROP POLICY IF EXISTS verity_roster_draft_owner_access ON public."StudentRosterImportDraft";
CREATE POLICY verity_roster_draft_owner_access
ON public."StudentRosterImportDraft"
FOR SELECT TO authenticated
USING (
  "createdBy"=(SELECT auth.uid())::text
  AND status='DRAFT'
  AND "expiresAt">now()
  AND public.verity_has_approved_credential_issuer("organizationId")
);

DROP POLICY IF EXISTS verity_roster_draft_owner_insert ON public."StudentRosterImportDraft";
CREATE POLICY verity_roster_draft_owner_insert
ON public."StudentRosterImportDraft"
FOR INSERT TO authenticated
WITH CHECK (
  "createdBy"=(SELECT auth.uid())::text
  AND status='DRAFT' AND revision=1
  AND "expiresAt">now()
  AND public.verity_has_approved_credential_issuer("organizationId")
  AND EXISTS (
    SELECT 1 FROM public."Organization" o
    WHERE o.id="StudentRosterImportDraft"."organizationId"
      AND o.status='APPROVED' AND o.type IN ('INSTITUTION','EMPLOYER')
  )
);

DROP POLICY IF EXISTS verity_roster_draft_owner_update ON public."StudentRosterImportDraft";
CREATE POLICY verity_roster_draft_owner_update
ON public."StudentRosterImportDraft"
FOR UPDATE TO authenticated
USING (
  "createdBy"=(SELECT auth.uid())::text
  AND status='DRAFT' AND "expiresAt">now()
  AND public.verity_has_approved_credential_issuer("organizationId")
)
WITH CHECK (
  "createdBy"=(SELECT auth.uid())::text
  AND status='DRAFT' AND "expiresAt">now()
  AND public.verity_has_approved_credential_issuer("organizationId")
);

DROP POLICY IF EXISTS verity_roster_draft_owner_delete ON public."StudentRosterImportDraft";
CREATE POLICY verity_roster_draft_owner_delete
ON public."StudentRosterImportDraft"
FOR DELETE TO authenticated
USING (
  "createdBy"=(SELECT auth.uid())::text
  AND status='DRAFT'
  AND public.verity_has_approved_credential_issuer("organizationId")
);

DROP POLICY IF EXISTS verity_roster_draft_chunk_owner_access ON public."StudentRosterImportDraftChunk";
CREATE POLICY verity_roster_draft_chunk_owner_access
ON public."StudentRosterImportDraftChunk"
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public."StudentRosterImportDraft" d
    WHERE d.id="StudentRosterImportDraftChunk"."draftId"
      AND d."organizationId"="StudentRosterImportDraftChunk"."organizationId"
      AND d."createdBy"=(SELECT auth.uid())::text
      AND d.status='DRAFT' AND d."expiresAt">now()
      AND public.verity_has_approved_credential_issuer(d."organizationId")
  )
);

DROP POLICY IF EXISTS verity_roster_draft_chunk_owner_insert ON public."StudentRosterImportDraftChunk";
CREATE POLICY verity_roster_draft_chunk_owner_insert
ON public."StudentRosterImportDraftChunk"
FOR INSERT TO authenticated
WITH CHECK (
  "updatedBy"=(SELECT auth.uid())::text
  AND EXISTS (
    SELECT 1 FROM public."StudentRosterImportDraft" d
    WHERE d.id="StudentRosterImportDraftChunk"."draftId"
      AND d."organizationId"="StudentRosterImportDraftChunk"."organizationId"
      AND d."createdBy"=(SELECT auth.uid())::text
      AND d.status='DRAFT' AND d."expiresAt">now()
      AND "StudentRosterImportDraftChunk"."chunkIndex"<d."totalChunks"
      AND jsonb_array_length("StudentRosterImportDraftChunk".rows)
        =least(100,d."totalRows"-("StudentRosterImportDraftChunk"."chunkIndex"*100))
      AND public.verity_has_approved_credential_issuer(d."organizationId")
  )
);

DROP POLICY IF EXISTS verity_roster_draft_chunk_owner_update ON public."StudentRosterImportDraftChunk";
CREATE POLICY verity_roster_draft_chunk_owner_update
ON public."StudentRosterImportDraftChunk"
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public."StudentRosterImportDraft" d
    WHERE d.id="StudentRosterImportDraftChunk"."draftId"
      AND d."organizationId"="StudentRosterImportDraftChunk"."organizationId"
      AND d."createdBy"=(SELECT auth.uid())::text
      AND d.status='DRAFT' AND d."expiresAt">now()
      AND public.verity_has_approved_credential_issuer(d."organizationId")
  )
)
WITH CHECK (
  "updatedBy"=(SELECT auth.uid())::text
  AND EXISTS (
    SELECT 1 FROM public."StudentRosterImportDraft" d
    WHERE d.id="StudentRosterImportDraftChunk"."draftId"
      AND d."organizationId"="StudentRosterImportDraftChunk"."organizationId"
      AND d."createdBy"=(SELECT auth.uid())::text
      AND d.status='DRAFT' AND d."expiresAt">now()
      AND "StudentRosterImportDraftChunk"."chunkIndex"<d."totalChunks"
      AND jsonb_array_length("StudentRosterImportDraftChunk".rows)
        =least(100,d."totalRows"-("StudentRosterImportDraftChunk"."chunkIndex"*100))
      AND public.verity_has_approved_credential_issuer(d."organizationId")
  )
);

DROP POLICY IF EXISTS verity_roster_draft_chunk_owner_delete ON public."StudentRosterImportDraftChunk";
CREATE POLICY verity_roster_draft_chunk_owner_delete
ON public."StudentRosterImportDraftChunk"
FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public."StudentRosterImportDraft" d
    WHERE d.id="StudentRosterImportDraftChunk"."draftId"
      AND d."organizationId"="StudentRosterImportDraftChunk"."organizationId"
      AND d."createdBy"=(SELECT auth.uid())::text
      AND d.status='DRAFT'
      AND public.verity_has_approved_credential_issuer(d."organizationId")
  )
);

COMMENT ON TABLE public."StudentRosterImportDraft" IS
'Private, uploader-owned, expiring working drafts. Never read by roster import workers and never commits StudentRoster rows.';
COMMENT ON TABLE public."StudentRosterImportDraftChunk" IS
'100-row chunks for resumable spreadsheet editing. Draft chunks are deleted when a draft is converted or abandoned.';
