-- VERITY institutional and organization roster approval and correction controls.
-- Additive migration: existing roster records and issued certificates are preserved.

-- RLS helper: permit approved credential-issuing institutions and organizations.
CREATE OR REPLACE FUNCTION public.verity_has_approved_credential_issuer(p_organization_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $
  SELECT EXISTS (SELECT 1 FROM public."OrganizationCapability" c
    WHERE c."organizationId"=p_organization_id
      AND c.capability='ISSUE_CREDENTIALS' AND c.status='APPROVED');
$;
REVOKE ALL ON FUNCTION public.verity_has_approved_credential_issuer(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.verity_has_approved_credential_issuer(text) TO authenticated;

ALTER TABLE public."StudentRosterImport"
  DROP CONSTRAINT IF EXISTS "StudentRosterImport_status_check";
ALTER TABLE public."StudentRosterImport"
  ADD CONSTRAINT "StudentRosterImport_status_check"
  CHECK (status IN ('UPLOADING','AWAITING_APPROVAL','QUEUED','PROCESSING','COMPLETED','PARTIAL','FAILED','REJECTED')),
  ADD COLUMN IF NOT EXISTS "submittedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "approvedBy" text REFERENCES public."User"("id"),
  ADD COLUMN IF NOT EXISTS "approvedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "rejectedBy" text REFERENCES public."User"("id"),
  ADD COLUMN IF NOT EXISTS "rejectedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "rejectionReason" text;

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
        AND o.type IN ('INSTITUTION','EMPLOYER') AND o.status='APPROVED' AND public.verity_has_approved_credential_issuer(o.id)
        AND (
          o."ownerId"=(SELECT auth.uid())::text
          OR EXISTS (
            SELECT 1 FROM public."InstitutionICTStaff" i
            WHERE o.type='INSTITUTION' AND i."organizationId"=o.id AND i."userId"=(SELECT auth.uid())::text
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
    AND EXISTS (
      SELECT 1 FROM public."Organization" o
      WHERE o.id="StudentRosterImport"."organizationId"
        AND o.type IN ('INSTITUTION','EMPLOYER') AND o.status='APPROVED' AND public.verity_has_approved_credential_issuer(o.id)
        AND (
          o."ownerId"=(SELECT auth.uid())::text
          OR EXISTS (
            SELECT 1 FROM public."InstitutionICTStaff" i
            WHERE o.type='INSTITUTION' AND i."organizationId"=o.id AND i."userId"=(SELECT auth.uid())::text
              AND i.status='ACTIVE' AND 'roster:manage'=ANY(i.permissions)
          )
        )
    )
  );

CREATE POLICY verity_student_import_owner_approval
  ON public."StudentRosterImport" FOR UPDATE TO authenticated
  USING (
    status='AWAITING_APPROVAL'
    AND EXISTS (
      SELECT 1 FROM public."Organization" o
      WHERE o.id="StudentRosterImport"."organizationId"
        AND o.type IN ('INSTITUTION','EMPLOYER') AND o.status='APPROVED' AND public.verity_has_approved_credential_issuer(o.id)
        AND o."ownerId"=(SELECT auth.uid())::text
    )
  )
  WITH CHECK (
    status='QUEUED'
    AND "approvedBy"=(SELECT auth.uid())::text
    AND "approvedAt" IS NOT NULL
    AND "submittedAt" IS NOT NULL
    AND "processedChunks"=0 AND "failedChunks"=0
    AND "insertedRows"=0 AND "duplicateRows"=0 AND "completedAt" IS NULL
    AND EXISTS (
      SELECT 1 FROM public."Organization" o
      WHERE o.id="StudentRosterImport"."organizationId"
        AND o.type IN ('INSTITUTION','EMPLOYER') AND o.status='APPROVED' AND public.verity_has_approved_credential_issuer(o.id)
        AND o."ownerId"=(SELECT auth.uid())::text
    )
  );


-- Freeze the import manifest and enforce the two human-controlled state changes.
CREATE OR REPLACE FUNCTION public.verity_guard_student_roster_import()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE v_role text := coalesce(current_setting('request.jwt.claim.role',true),'');
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Student roster import history cannot be deleted';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status','submittedAt','approvedBy','approvedAt','rejectedBy','rejectedAt','rejectionReason','updatedAt','processedChunks','failedChunks','insertedRows','duplicateRows','errorSummary','completedAt'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status','submittedAt','approvedBy','approvedAt','rejectedBy','rejectedAt','rejectionReason','updatedAt','processedChunks','failedChunks','insertedRows','duplicateRows','errorSummary','completedAt']) THEN
    RAISE EXCEPTION 'Student roster import manifest fields are immutable after staging';
  END IF;
  IF v_role <> 'service_role' THEN
    IF OLD.status='UPLOADING' AND NEW.status='AWAITING_APPROVAL' THEN
      IF NEW."submittedAt" IS NULL OR NEW."approvedBy" IS NOT NULL OR NEW."approvedAt" IS NOT NULL
         OR NEW."processedChunks"<>OLD."processedChunks" OR NEW."failedChunks"<>OLD."failedChunks"
         OR NEW."insertedRows"<>OLD."insertedRows" OR NEW."duplicateRows"<>OLD."duplicateRows" THEN
        RAISE EXCEPTION 'Invalid roster import submission transition';
      END IF;
    ELSIF OLD.status='AWAITING_APPROVAL' AND NEW.status='REJECTED' THEN
      IF NEW."rejectedBy" IS NULL OR NEW."rejectedAt" IS NULL
         OR length(btrim(coalesce(NEW."rejectionReason",''))) NOT BETWEEN 10 AND 1000
         OR NEW."approvedBy" IS NOT NULL OR NEW."approvedAt" IS NOT NULL
         OR NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt" THEN
        RAISE EXCEPTION 'Invalid roster import rejection transition';
      END IF;
    ELSIF OLD.status='AWAITING_APPROVAL' AND NEW.status='QUEUED' THEN
      IF NEW."approvedBy" IS NULL OR NEW."approvedAt" IS NULL
         OR NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt"
         OR NEW."processedChunks"<>OLD."processedChunks" OR NEW."failedChunks"<>OLD."failedChunks"
         OR NEW."insertedRows"<>OLD."insertedRows" OR NEW."duplicateRows"<>OLD."duplicateRows" THEN
        RAISE EXCEPTION 'Invalid roster import approval transition';
      END IF;
    ELSE
      RAISE EXCEPTION 'Only the uploader submission and approved issuer-owner decisions are allowed';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS verity_guard_student_roster_import ON public."StudentRosterImport";
CREATE TRIGGER verity_guard_student_roster_import
  BEFORE UPDATE OR DELETE ON public."StudentRosterImport"
  FOR EACH ROW EXECUTE FUNCTION public.verity_guard_student_roster_import();
REVOKE ALL ON FUNCTION public.verity_guard_student_roster_import() FROM PUBLIC,anon,authenticated,service_role;

GRANT UPDATE ON public."StudentRosterImport" TO authenticated;

CREATE POLICY verity_student_import_owner_rejection
  ON public."StudentRosterImport" FOR UPDATE TO authenticated
  USING (
    status='AWAITING_APPROVAL'
    AND EXISTS (SELECT 1 FROM public."Organization" o
      WHERE o.id="StudentRosterImport"."organizationId" AND o.type IN ('INSTITUTION','EMPLOYER')
        AND o.status='APPROVED' AND public.verity_has_approved_credential_issuer(o.id)
        AND o."ownerId"=(SELECT auth.uid())::text)
  )
  WITH CHECK (
    status='REJECTED'
    AND "rejectedBy"=(SELECT auth.uid())::text
    AND "rejectedAt" IS NOT NULL
    AND length(btrim(coalesce("rejectionReason",''))) BETWEEN 10 AND 1000
    AND "approvedBy" IS NULL AND "approvedAt" IS NULL
    AND "submittedAt" IS NOT NULL
    AND EXISTS (SELECT 1 FROM public."Organization" o
      WHERE o.id="StudentRosterImport"."organizationId" AND o.type IN ('INSTITUTION','EMPLOYER')
        AND o.status='APPROVED' AND public.verity_has_approved_credential_issuer(o.id)
        AND o."ownerId"=(SELECT auth.uid())::text)
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
    AND EXISTS (SELECT 1 FROM public."Organization" o WHERE o.id="organizationId" AND o.type IN ('INSTITUTION','EMPLOYER')
      AND o.status='APPROVED' AND public.verity_has_approved_credential_issuer(o.id) AND (
        o."ownerId"=(SELECT auth.uid())::text
        OR EXISTS (SELECT 1 FROM public."InstitutionICTStaff" i WHERE o.type='INSTITUTION' AND i."organizationId"=o.id
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
    AND EXISTS (SELECT 1 FROM public."Organization" o WHERE o.id="organizationId" AND o.type IN ('INSTITUTION','EMPLOYER')
      AND o.status='APPROVED' AND public.verity_has_approved_credential_issuer(o.id) AND (
        o."ownerId"=(SELECT auth.uid())::text
        OR EXISTS (SELECT 1 FROM public."InstitutionICTStaff" i WHERE o.type='INSTITUTION' AND i."organizationId"=o.id
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


CREATE OR REPLACE FUNCTION public.verity_link_credential_replacement(
  p_request_id text, p_replacement_certificate_row_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  v_request public."CredentialCorrectionRequest"%ROWTYPE;
  v_org public."Organization"%ROWTYPE;
  v_original public."Certificate"%ROWTYPE;
  v_replacement public."Certificate"%ROWTYPE;
BEGIN
  SELECT * INTO v_request FROM public."CredentialCorrectionRequest" WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Credential correction request not found'; END IF;
  SELECT * INTO v_org FROM public."Organization" WHERE id=v_request."organizationId";
  IF v_org."ownerId" IS DISTINCT FROM auth.uid()::text THEN
    RAISE EXCEPTION 'Only the Institution Owner can link a replacement credential';
  END IF;
  IF v_request.status <> 'APPROVED' THEN RAISE EXCEPTION 'Only an approved correction request can be completed'; END IF;
  SELECT * INTO v_original FROM public."Certificate" WHERE id=v_request."certificateRowId";
  SELECT * INTO v_replacement FROM public."Certificate" WHERE id=p_replacement_certificate_row_id;
  IF v_original.id IS NULL OR v_original.digest IS DISTINCT FROM v_request."originalDigest"
     OR v_original."certificateId" IS DISTINCT FROM v_request."certificateId" THEN
    RAISE EXCEPTION 'The original issued certificate no longer matches the correction request';
  END IF;
  IF v_original.status::text <> 'REVOKED' THEN
    RAISE EXCEPTION 'Revoke the original credential with a documented reason before linking its replacement';
  END IF;
  IF v_replacement.id IS NULL OR v_replacement."organizationId" IS DISTINCT FROM v_request."organizationId"
     OR v_replacement.id=v_original.id OR v_replacement.digest=v_original.digest
     OR v_replacement.status::text <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Replacement must be a distinct active credential issued by the same institution';
  END IF;
  UPDATE public."CredentialCorrectionRequest" SET status='REISSUED',
    "replacementCertificateRowId"=v_replacement.id,"reissuedAt"=now()
    WHERE id=v_request.id;
  INSERT INTO public."AuditEvent"(id,"actorId",action,entity,"entityId",metadata,"createdAt")
  VALUES(gen_random_uuid()::text,auth.uid()::text,'CREDENTIAL_CORRECTION_REISSUED',
    'CredentialCorrectionRequest',v_request.id,
    jsonb_build_object('organizationId',v_request."organizationId",'originalCertificateId',v_original."certificateId",
      'replacementCertificateId',v_replacement."certificateId",'originalDigest',v_original.digest,
      'replacementDigest',v_replacement.digest),now());
  RETURN jsonb_build_object('status','REISSUED','originalCertificateUnchanged',true,
    'originalCertificateStatus','REVOKED','replacementCertificateId',v_replacement."certificateId");
END;
$$;
REVOKE ALL ON FUNCTION public.verity_link_credential_replacement(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.verity_link_credential_replacement(text,text) TO authenticated;

-- No direct updates/deletes to either request queue. Decisions go through the
-- narrowly scoped owner-only functions so review and audit are atomic.
