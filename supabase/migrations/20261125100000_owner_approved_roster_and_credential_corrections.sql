-- VERITY institutional roster approval and correction controls.
-- Additive migration: existing roster records and issued certificates are preserved.

ALTER TABLE public."StudentRosterImport"
  DROP CONSTRAINT IF EXISTS "StudentRosterImport_status_check";
ALTER TABLE public."StudentRosterImport"
  ADD CONSTRAINT "StudentRosterImport_status_check"
  CHECK (status IN ('UPLOADING','AWAITING_APPROVAL','QUEUED','PROCESSING','COMPLETED','PARTIAL','FAILED')),
  ADD COLUMN IF NOT EXISTS "submittedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "approvedBy" text REFERENCES public."User"("id"),
  ADD COLUMN IF NOT EXISTS "approvedAt" timestamptz;

-- Replace the old one-step UPLOADING -> QUEUED transition with two distinct
-- transitions: uploader submits for review; only the institution owner queues it.
DROP POLICY IF EXISTS verity_student_import_roster_queue_update ON public."StudentRosterImport";
CREATE POLICY verity_student_import_submit_for_approval
  ON public."StudentRosterImport" FOR UPDATE TO authenticated
  USING (
    status='UPLOADING'
    AND "uploadedBy"=(SELECT auth.uid())::text
    AND EXISTS (
      SELECT 1 FROM public."Organization" o
      WHERE o.id="StudentRosterImport"."organizationId"
        AND o.type='INSTITUTION' AND o.status='APPROVED'
        AND (
          o."ownerId"=(SELECT auth.uid())::text
          OR EXISTS (
            SELECT 1 FROM public."InstitutionICTStaff" i
            WHERE i."organizationId"=o.id AND i."userId"=(SELECT auth.uid())::text
              AND i.status='ACTIVE' AND 'roster:manage'=ANY(i.permissions)
          )
        )
    )
  )
  WITH CHECK (
    status='AWAITING_APPROVAL'
    AND "uploadedBy"=(SELECT auth.uid())::text
    AND "approvedBy" IS NULL AND "approvedAt" IS NULL
    AND "submittedAt" IS NOT NULL
    AND "processedChunks"=0 AND "failedChunks"=0
    AND "insertedRows"=0 AND "duplicateRows"=0 AND "completedAt" IS NULL
  );

CREATE POLICY verity_student_import_owner_approval
  ON public."StudentRosterImport" FOR UPDATE TO authenticated
  USING (
    status='AWAITING_APPROVAL'
    AND EXISTS (
      SELECT 1 FROM public."Organization" o
      WHERE o.id="StudentRosterImport"."organizationId"
        AND o.type='INSTITUTION' AND o."ownerId"=(SELECT auth.uid())::text
    )
  )
  WITH CHECK (
    status='QUEUED'
    AND "approvedBy"=(SELECT auth.uid())::text
    AND "approvedAt" IS NOT NULL
    AND "submittedAt" IS NOT NULL
    AND "processedChunks"=0 AND "failedChunks"=0
    AND "insertedRows"=0 AND "duplicateRows"=0 AND "completedAt" IS NULL
  );

-- Remove direct authenticated roster mutation. Imports are committed by the
-- privileged queue processor; corrections use the owner-approved RPC below.
DROP POLICY IF EXISTS "Institution owners and ICT manage roster" ON public."StudentRoster";
REVOKE INSERT, UPDATE, DELETE ON public."StudentRoster" FROM authenticated;
GRANT SELECT ON public."StudentRoster" TO authenticated;

CREATE TABLE IF NOT EXISTS public."StudentRosterCorrectionRequest" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organizationId" text NOT NULL REFERENCES public."Organization"(id) ON DELETE CASCADE,
  "rosterId" text NOT NULL REFERENCES public."StudentRoster"(id) ON DELETE RESTRICT,
  "requestedBy" text NOT NULL REFERENCES public."User"(id),
  "originalRecord" jsonb NOT NULL,
  "proposedRecord" jsonb NOT NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 10 AND 1000),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','CONFLICT')),
  "reviewedBy" text REFERENCES public."User"(id),
  "decisionNote" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "reviewedAt" timestamptz,
  CHECK (jsonb_typeof("originalRecord")='object'),
  CHECK (jsonb_typeof("proposedRecord")='object')
);
CREATE INDEX IF NOT EXISTS "StudentRosterCorrection_org_status_idx"
  ON public."StudentRosterCorrectionRequest"("organizationId",status,"createdAt" DESC);
ALTER TABLE public."StudentRosterCorrectionRequest" ENABLE ROW LEVEL SECURITY;
CREATE POLICY verity_roster_correction_read
  ON public."StudentRosterCorrectionRequest" FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public."Organization" o WHERE o.id="organizationId" AND o."ownerId"=(SELECT auth.uid())::text)
    OR EXISTS (SELECT 1 FROM public."InstitutionICTStaff" i WHERE i."organizationId"="StudentRosterCorrectionRequest"."organizationId"
      AND i."userId"=(SELECT auth.uid())::text AND i.status='ACTIVE' AND 'roster:manage'=ANY(i.permissions))
  );
CREATE POLICY verity_roster_correction_submit
  ON public."StudentRosterCorrectionRequest" FOR INSERT TO authenticated
  WITH CHECK (
    "requestedBy"=(SELECT auth.uid())::text AND status='PENDING'
    AND "reviewedBy" IS NULL AND "reviewedAt" IS NULL
    AND EXISTS (SELECT 1 FROM public."Organization" o WHERE o.id="organizationId" AND o.type='INSTITUTION'
      AND o.status='APPROVED' AND (
        o."ownerId"=(SELECT auth.uid())::text
        OR EXISTS (SELECT 1 FROM public."InstitutionICTStaff" i WHERE i."organizationId"=o.id
          AND i."userId"=(SELECT auth.uid())::text AND i.status='ACTIVE' AND 'roster:manage'=ANY(i.permissions)
        )
      ))
    AND EXISTS (SELECT 1 FROM public."StudentRoster" r WHERE r.id="rosterId" AND r."organizationId"="StudentRosterCorrectionRequest"."organizationId")
  );
GRANT SELECT, INSERT ON public."StudentRosterCorrectionRequest" TO authenticated;

CREATE OR REPLACE FUNCTION public.verity_decide_student_roster_correction(
  p_request_id text, p_decision text, p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  v_request public."StudentRosterCorrectionRequest"%ROWTYPE;
  v_org public."Organization"%ROWTYPE;
  v_roster public."StudentRoster"%ROWTYPE;
  v_proposed jsonb;
  v_number text;
  v_name text;
BEGIN
  IF p_decision NOT IN ('APPROVED','REJECTED') THEN RAISE EXCEPTION 'Decision must be APPROVED or REJECTED'; END IF;
  SELECT * INTO v_request FROM public."StudentRosterCorrectionRequest"
    WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Correction request not found'; END IF;
  SELECT * INTO v_org FROM public."Organization" WHERE id=v_request."organizationId";
  IF v_org."ownerId" IS DISTINCT FROM auth.uid()::text THEN
    RAISE EXCEPTION 'Only the institution owner can decide roster corrections';
  END IF;
  IF v_request.status <> 'PENDING' THEN RAISE EXCEPTION 'This correction request has already been decided'; END IF;
  SELECT * INTO v_roster FROM public."StudentRoster" WHERE id=v_request."rosterId" FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Student roster record no longer exists'; END IF;
  IF (to_jsonb(v_roster) - ARRAY['updatedAt']) IS DISTINCT FROM (v_request."originalRecord" - ARRAY['updatedAt']) THEN
    UPDATE public."StudentRosterCorrectionRequest" SET status='CONFLICT',"reviewedBy"=auth.uid()::text,
      "reviewedAt"=now(),"decisionNote"='The source roster record changed after this request was submitted; a new request is required.'
      WHERE id=v_request.id;
    RETURN jsonb_build_object('status','CONFLICT');
  END IF;
  IF p_decision='APPROVED' THEN
    v_proposed:=v_request."proposedRecord";
    v_number:=nullif(btrim(v_proposed->>'studentNumber'),'');
    v_name:=nullif(btrim(v_proposed->>'fullName'),'');
    IF v_number IS NULL OR length(v_number) NOT BETWEEN 2 AND 80 OR v_name IS NULL OR length(v_name) NOT BETWEEN 2 AND 160 THEN
      RAISE EXCEPTION 'Student number and full name are required and must be valid';
    END IF;
    IF v_roster."claimedUserId" IS NOT NULL AND upper(v_number) <> upper(v_roster."studentNumber") THEN
      RAISE EXCEPTION 'A claimed student number cannot be changed through a profile correction; use the identity dispute and recovery process';
    END IF;
    UPDATE public."StudentRoster" SET
      "studentNumber"=v_number, "normalizedStudentNumber"=upper(v_number),
      "fullName"=v_name,
      "institutionalEmail"=nullif(btrim(v_proposed->>'institutionalEmail'),''),
      faculty=nullif(btrim(v_proposed->>'faculty'),''),
      department=nullif(btrim(v_proposed->>'department'),''),
      programme=nullif(btrim(v_proposed->>'programme'),''),
      qualification=nullif(btrim(v_proposed->>'qualification'),''),
      classification=nullif(btrim(v_proposed->>'classification'),''),
      "awardDate"=nullif(v_proposed->>'awardDate','')::date,
      "academicSession"=coalesce(v_proposed->>'academicSession',''),
      "updatedAt"=now()
    WHERE id=v_roster.id;
  END IF;
  UPDATE public."StudentRosterCorrectionRequest" SET status=p_decision,
    "reviewedBy"=auth.uid()::text,"reviewedAt"=now(),
    "decisionNote"=left(coalesce(p_note,''),1000)
    WHERE id=v_request.id;
  INSERT INTO public."AuditEvent"(id,"actorId",action,entity,"entityId",metadata,"createdAt")
  VALUES(gen_random_uuid()::text,auth.uid()::text,
    CASE WHEN p_decision='APPROVED' THEN 'STUDENT_ROSTER_CORRECTION_APPROVED' ELSE 'STUDENT_ROSTER_CORRECTION_REJECTED' END,
    'StudentRosterCorrectionRequest',v_request.id,
    jsonb_build_object('organizationId',v_request."organizationId",'rosterId',v_roster.id,'reason',v_request.reason),
    now());
  RETURN jsonb_build_object('status',p_decision);
END;
$$;
REVOKE ALL ON FUNCTION public.verity_decide_student_roster_correction(text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.verity_decide_student_roster_correction(text,text,text) TO authenticated;

CREATE TABLE IF NOT EXISTS public."CredentialCorrectionRequest" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organizationId" text NOT NULL REFERENCES public."Organization"(id) ON DELETE CASCADE,
  "certificateRowId" text NOT NULL REFERENCES public."Certificate"(id) ON DELETE RESTRICT,
  "certificateId" text NOT NULL,
  "originalDigest" text NOT NULL CHECK ("originalDigest" ~ '^[a-f0-9]{64}$'),
  "proposedRecord" jsonb NOT NULL CHECK (jsonb_typeof("proposedRecord")='object'),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 10 AND 1000),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','REISSUED')),
  "requestedBy" text NOT NULL REFERENCES public."User"(id),
  "reviewedBy" text REFERENCES public."User"(id),
  "decisionNote" text,
  "replacementCertificateRowId" text REFERENCES public."Certificate"(id),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "reviewedAt" timestamptz,
  "reissuedAt" timestamptz
);
CREATE INDEX IF NOT EXISTS "CredentialCorrection_org_status_idx"
  ON public."CredentialCorrectionRequest"("organizationId",status,"createdAt" DESC);
ALTER TABLE public."CredentialCorrectionRequest" ENABLE ROW LEVEL SECURITY;
CREATE POLICY verity_credential_correction_read
  ON public."CredentialCorrectionRequest" FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public."Organization" o WHERE o.id="organizationId" AND o."ownerId"=(SELECT auth.uid())::text)
    OR EXISTS (SELECT 1 FROM public."InstitutionICTStaff" i WHERE i."organizationId"="CredentialCorrectionRequest"."organizationId"
      AND i."userId"=(SELECT auth.uid())::text AND i.status='ACTIVE' AND 'roster:manage'=ANY(i.permissions))
  );
CREATE POLICY verity_credential_correction_submit
  ON public."CredentialCorrectionRequest" FOR INSERT TO authenticated
  WITH CHECK (
    "requestedBy"=(SELECT auth.uid())::text AND status='PENDING'
    AND "reviewedBy" IS NULL AND "reviewedAt" IS NULL
    AND EXISTS (SELECT 1 FROM public."Organization" o WHERE o.id="organizationId" AND o.type='INSTITUTION'
      AND o.status='APPROVED' AND (
        o."ownerId"=(SELECT auth.uid())::text
        OR EXISTS (SELECT 1 FROM public."InstitutionICTStaff" i WHERE i."organizationId"=o.id
          AND i."userId"=(SELECT auth.uid())::text AND i.status='ACTIVE' AND 'roster:manage'=ANY(i.permissions)
        )
      ))
    AND EXISTS (SELECT 1 FROM public."Certificate" c WHERE c.id="certificateRowId"
      AND c."organizationId"="CredentialCorrectionRequest"."organizationId"
      AND c.digest="CredentialCorrectionRequest"."originalDigest")
  );
GRANT SELECT, INSERT ON public."CredentialCorrectionRequest" TO authenticated;

CREATE OR REPLACE FUNCTION public.verity_decide_credential_correction(
  p_request_id text, p_decision text, p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_request public."CredentialCorrectionRequest"%ROWTYPE; v_org public."Organization"%ROWTYPE;
BEGIN
  IF p_decision NOT IN ('APPROVED','REJECTED') THEN RAISE EXCEPTION 'Decision must be APPROVED or REJECTED'; END IF;
  SELECT * INTO v_request FROM public."CredentialCorrectionRequest" WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Credential correction request not found'; END IF;
  SELECT * INTO v_org FROM public."Organization" WHERE id=v_request."organizationId";
  IF v_org."ownerId" IS DISTINCT FROM auth.uid()::text THEN
    RAISE EXCEPTION 'Only the institution owner can decide credential corrections';
  END IF;
  IF v_request.status <> 'PENDING' THEN RAISE EXCEPTION 'This credential correction request has already been decided'; END IF;
  -- Deliberately do not update Certificate. The issued record and its digest
  -- remain immutable. Approval only authorizes a separate replacement issuance.
  UPDATE public."CredentialCorrectionRequest" SET status=p_decision,
    "reviewedBy"=auth.uid()::text,"reviewedAt"=now(),"decisionNote"=left(coalesce(p_note,''),1000)
    WHERE id=v_request.id;
  INSERT INTO public."AuditEvent"(id,"actorId",action,entity,"entityId",metadata,"createdAt")
  VALUES(gen_random_uuid()::text,auth.uid()::text,
    CASE WHEN p_decision='APPROVED' THEN 'CREDENTIAL_CORRECTION_APPROVED' ELSE 'CREDENTIAL_CORRECTION_REJECTED' END,
    'CredentialCorrectionRequest',v_request.id,
    jsonb_build_object('organizationId',v_request."organizationId",'certificateId',v_request."certificateId",
      'originalDigest',v_request."originalDigest",'reason',v_request.reason,'replacementRequired',p_decision='APPROVED'),
    now());
  RETURN jsonb_build_object('status',p_decision,'originalCertificateUnchanged',true);
END;
$$;
REVOKE ALL ON FUNCTION public.verity_decide_credential_correction(text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.verity_decide_credential_correction(text,text,text) TO authenticated;

-- No direct updates/deletes to either request queue. Decisions go through the
-- narrowly scoped owner-only functions so review and audit are atomic.
