-- Enable approved issuer and verifier capabilities across existing VERITY workflows.
-- This migration is additive: it preserves existing organization types, certificates,
-- template artwork, storage paths, ledger events, and bulk-issuance batch limits.

-- ---------------------------------------------------------------------------
-- Student / graduate registry authorization
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Institution owners and ICT can view roster" ON public."StudentRoster";
CREATE POLICY "Institution owners and ICT can view roster"
ON public."StudentRoster" FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public."Organization" o
    WHERE o.id="StudentRoster"."organizationId"
      AND o."ownerId"=(SELECT auth.uid())::text
      AND private.verity_organization_has_capability(o.id,'ISSUE_CREDENTIALS')
  )
  OR EXISTS (
    SELECT 1 FROM public."InstitutionICTStaff" i
    JOIN public."Organization" o ON o.id=i."organizationId"
    WHERE i."organizationId"="StudentRoster"."organizationId"
      AND i."userId"=(SELECT auth.uid())::text
      AND i.status='ACTIVE'
      AND 'roster:manage'=ANY(i.permissions)
      AND private.verity_organization_has_capability(o.id,'ISSUE_CREDENTIALS')
  )
);

DROP POLICY IF EXISTS "Institution owners and ICT manage roster" ON public."StudentRoster";
CREATE POLICY "Institution owners and ICT manage roster"
ON public."StudentRoster" FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public."Organization" o
    WHERE o.id="StudentRoster"."organizationId"
      AND o."ownerId"=(SELECT auth.uid())::text
      AND private.verity_organization_has_capability(o.id,'ISSUE_CREDENTIALS')
  )
  OR EXISTS (
    SELECT 1 FROM public."InstitutionICTStaff" i
    JOIN public."Organization" o ON o.id=i."organizationId"
    WHERE i."organizationId"="StudentRoster"."organizationId"
      AND i."userId"=(SELECT auth.uid())::text
      AND i.status='ACTIVE'
      AND 'roster:manage'=ANY(i.permissions)
      AND private.verity_organization_has_capability(o.id,'ISSUE_CREDENTIALS')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public."Organization" o
    WHERE o.id="StudentRoster"."organizationId"
      AND o."ownerId"=(SELECT auth.uid())::text
      AND private.verity_organization_has_capability(o.id,'ISSUE_CREDENTIALS')
  )
  OR EXISTS (
    SELECT 1 FROM public."InstitutionICTStaff" i
    JOIN public."Organization" o ON o.id=i."organizationId"
    WHERE i."organizationId"="StudentRoster"."organizationId"
      AND i."userId"=(SELECT auth.uid())::text
      AND i.status='ACTIVE'
      AND 'roster:manage'=ANY(i.permissions)
      AND private.verity_organization_has_capability(o.id,'ISSUE_CREDENTIALS')
  )
);

DROP POLICY IF EXISTS "Institution owners and ICT create roster import audit" ON public."StudentRosterImport";
CREATE POLICY "Institution owners and ICT create roster import audit"
ON public."StudentRosterImport" FOR INSERT TO authenticated
WITH CHECK (
  "uploadedBy"=(SELECT auth.uid())::text
  AND (
    (status='UPLOADING' AND "insertedRows"=0 AND "duplicateRows"=0
      AND "processedChunks"=0 AND "failedChunks"=0 AND "completedAt" IS NULL)
    OR
    (status='COMPLETED' AND "totalChunks"=0 AND "duplicateRows"=0
      AND "processedChunks"=0 AND "failedChunks"=0 AND "completedAt" IS NULL)
  )
  AND EXISTS (
    SELECT 1 FROM public."Organization" o
    WHERE o.id="StudentRosterImport"."organizationId"
      AND o.status='APPROVED'
      AND private.verity_organization_has_capability(o.id,'ISSUE_CREDENTIALS')
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

DROP POLICY IF EXISTS "Institution owners and ICT view roster imports" ON public."StudentRosterImport";
CREATE POLICY "Institution owners and ICT view roster imports"
ON public."StudentRosterImport" FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public."Organization" o
    WHERE o.id="StudentRosterImport"."organizationId"
      AND private.verity_organization_has_capability(o.id,'ISSUE_CREDENTIALS')
      AND (
        o."ownerId"=(SELECT auth.uid())::text
        OR EXISTS (
          SELECT 1 FROM public."InstitutionICTStaff" i
          WHERE i."organizationId"=o.id AND i."userId"=(SELECT auth.uid())::text
            AND i.status='ACTIVE' AND 'roster:manage'=ANY(i.permissions)
        )
      )
  )
  OR (SELECT private.is_admin())
);

DROP POLICY IF EXISTS verity_student_import_roster_queue_update ON public."StudentRosterImport";
CREATE POLICY verity_student_import_roster_queue_update
ON public."StudentRosterImport" FOR UPDATE TO authenticated
USING (
  status='UPLOADING'
  AND EXISTS (
    SELECT 1 FROM public."Organization" o
    WHERE o.id="StudentRosterImport"."organizationId"
      AND o.status='APPROVED'
      AND private.verity_organization_has_capability(o.id,'ISSUE_CREDENTIALS')
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
  status='QUEUED' AND "totalChunks">0 AND "processedChunks"=0
  AND "failedChunks"=0 AND "insertedRows"=0 AND "duplicateRows"=0
  AND "completedAt" IS NULL
  AND EXISTS (
    SELECT 1 FROM public."Organization" o
    WHERE o.id="StudentRosterImport"."organizationId"
      AND o.status='APPROVED'
      AND private.verity_organization_has_capability(o.id,'ISSUE_CREDENTIALS')
      AND (
        o."ownerId"=(SELECT auth.uid())::text
        OR EXISTS (
          SELECT 1 FROM public."InstitutionICTStaff" i
          WHERE i."organizationId"=o.id AND i."userId"=(SELECT auth.uid())::text
            AND i.status='ACTIVE' AND 'roster:manage'=ANY(i.permissions)
        )
      )
  )
);

DROP POLICY IF EXISTS verity_student_import_chunk_roster_read ON public."StudentImportChunk";
CREATE POLICY verity_student_import_chunk_roster_read
ON public."StudentImportChunk" FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public."Organization" o
    WHERE o.id="StudentImportChunk"."organizationId"
      AND private.verity_organization_has_capability(o.id,'ISSUE_CREDENTIALS')
      AND (
        o."ownerId"=(SELECT auth.uid())::text
        OR EXISTS (
          SELECT 1 FROM public."InstitutionICTStaff" i
          WHERE i."organizationId"=o.id AND i."userId"=(SELECT auth.uid())::text
            AND i.status='ACTIVE' AND 'roster:manage'=ANY(i.permissions)
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
      AND jsonb_array_length("StudentImportChunk".rows)=LEAST(100,(b."totalRows"-b."rejectedRows"-("StudentImportChunk"."chunkIndex"*100)))
      AND o.status='APPROVED'
      AND private.verity_organization_has_capability(o.id,'ISSUE_CREDENTIALS')
      AND (
        o."ownerId"=(SELECT auth.uid())::text
        OR EXISTS (
          SELECT 1 FROM public."InstitutionICTStaff" i
          WHERE i."organizationId"=o.id AND i."userId"=(SELECT auth.uid())::text
            AND i.status='ACTIVE' AND 'roster:manage'=ANY(i.permissions)
        )
      )
  )
);

DROP POLICY IF EXISTS "Institution owners and ICT manage activation tokens" ON public."StudentActivationToken";
CREATE POLICY "Institution owners and ICT manage activation tokens"
ON public."StudentActivationToken" FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public."Organization" o
    WHERE o.id="StudentActivationToken"."organizationId"
      AND o."ownerId"=(SELECT auth.uid())::text
      AND private.verity_organization_has_capability(o.id,'ISSUE_CREDENTIALS')
  )
  OR EXISTS (
    SELECT 1 FROM public."InstitutionICTStaff" i
    JOIN public."Organization" o ON o.id=i."organizationId"
    WHERE i."organizationId"="StudentActivationToken"."organizationId"
      AND i."userId"=(SELECT auth.uid())::text AND i.status='ACTIVE'
      AND (('roster:manage'=ANY(i.permissions)) OR ('registration:recover'=ANY(i.permissions)))
      AND private.verity_organization_has_capability(o.id,'ISSUE_CREDENTIALS')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public."Organization" o
    WHERE o.id="StudentActivationToken"."organizationId"
      AND o."ownerId"=(SELECT auth.uid())::text
      AND private.verity_organization_has_capability(o.id,'ISSUE_CREDENTIALS')
  )
  OR EXISTS (
    SELECT 1 FROM public."InstitutionICTStaff" i
    JOIN public."Organization" o ON o.id=i."organizationId"
    WHERE i."organizationId"="StudentActivationToken"."organizationId"
      AND i."userId"=(SELECT auth.uid())::text AND i.status='ACTIVE'
      AND (('roster:manage'=ANY(i.permissions)) OR ('registration:recover'=ANY(i.permissions)))
      AND private.verity_organization_has_capability(o.id,'ISSUE_CREDENTIALS')
  )
);

DROP POLICY IF EXISTS verity_membership_owner_add ON public."Membership";
CREATE POLICY verity_membership_owner_add
ON public."Membership" FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public."Organization" o
    WHERE o.id="Membership"."organizationId"
      AND o."ownerId"=(SELECT auth.uid())::text
      AND o.status='APPROVED'
      AND private.verity_organization_has_capability(o.id,'ISSUE_CREDENTIALS')
  )
);

DROP POLICY IF EXISTS verity_membership_owner_update ON public."Membership";
CREATE POLICY verity_membership_owner_update
ON public."Membership" FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public."Organization" o
    WHERE o.id="Membership"."organizationId"
      AND o."ownerId"=(SELECT auth.uid())::text
      AND private.verity_organization_has_capability(o.id,'ISSUE_CREDENTIALS')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public."Organization" o
    WHERE o.id="Membership"."organizationId"
      AND o."ownerId"=(SELECT auth.uid())::text
      AND private.verity_organization_has_capability(o.id,'ISSUE_CREDENTIALS')
  )
);

-- ---------------------------------------------------------------------------
-- Credential issuance, private documents and verifier consent
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS verity_certificate_admin_insert ON public."Certificate";
CREATE POLICY verity_certificate_admin_insert
ON public."Certificate" FOR INSERT TO authenticated
WITH CHECK (
  ((SELECT private.is_admin()) AND "issuerId"=(SELECT auth.uid())::text)
  OR EXISTS (
    SELECT 1 FROM public."Organization" o
    WHERE o.id="Certificate"."organizationId"
      AND o."ownerId"=(SELECT auth.uid())::text
      AND o.status='APPROVED'
      AND o."ownerId"="Certificate"."issuerId"
      AND private.verity_organization_has_capability(o.id,'ISSUE_CREDENTIALS')
  )
);

DROP POLICY IF EXISTS verity_document_insert_org_owner ON public."CertificateDocument";
CREATE POLICY verity_document_insert_org_owner
ON public."CertificateDocument" FOR INSERT TO authenticated
WITH CHECK (
  "uploadedBy"=(SELECT auth.uid())::text
  AND EXISTS (
    SELECT 1 FROM public."Organization" o
    JOIN public."Certificate" c ON c."organizationId"=o.id
    WHERE o.id="CertificateDocument"."organizationId"
      AND c.id="CertificateDocument"."certificateId"
      AND o."ownerId"=(SELECT auth.uid())::text
      AND o.status='APPROVED'
      AND private.verity_organization_has_capability(o.id,'ISSUE_CREDENTIALS')
  )
);

DROP POLICY IF EXISTS verity_document_read_scoped ON public."CertificateDocument";
CREATE POLICY verity_document_read_scoped
ON public."CertificateDocument" FOR SELECT TO authenticated
USING (
  (SELECT private.is_admin())
  OR EXISTS (
    SELECT 1 FROM public."Organization" o
    JOIN public."Certificate" c ON c.id="CertificateDocument"."certificateId"
    WHERE o.id="CertificateDocument"."organizationId"
      AND c.id="CertificateDocument"."certificateId"
      AND c."organizationId"=o.id
      AND o."ownerId"=(SELECT auth.uid())::text
      AND o.status='APPROVED'
  )
  OR EXISTS (
    SELECT 1 FROM public."Certificate" c
    WHERE c.id="CertificateDocument"."certificateId"
      AND c."organizationId"="CertificateDocument"."organizationId"
      AND c."graduateId"=(SELECT auth.uid())::text
  )
  OR (
    private.is_active_org_staff("organizationId",'documents:download')
    AND EXISTS (
      SELECT 1 FROM public."Certificate" c
      WHERE c.id="CertificateDocument"."certificateId"
        AND c."organizationId"="CertificateDocument"."organizationId"
    )
  )
  OR EXISTS (
    SELECT 1
    FROM public."CertificateAccessGrant" g
    JOIN public."Organization" o ON o.id=g."organizationId"
    JOIN public."Certificate" c ON c.id="CertificateDocument"."certificateId"
    WHERE g."certificateId"="CertificateDocument"."certificateId"
      AND c."organizationId"="CertificateDocument"."organizationId"
      AND g.status='APPROVED' AND g."expiresAt">now()
      AND c.status='ACTIVE'
      AND o."ownerId"=(SELECT auth.uid())::text
      AND o.status='APPROVED'
      AND private.verity_organization_has_capability(o.id,'VERIFY_CREDENTIALS')
  )
);

DROP POLICY IF EXISTS verity_certificate_granted_verifier_read ON public."Certificate";
CREATE POLICY verity_certificate_granted_verifier_read
ON public."Certificate" FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public."CertificateAccessGrant" g
    JOIN public."Organization" o ON o.id=g."organizationId"
    WHERE g."certificateId"="Certificate".id
      AND g.status='APPROVED'
      AND g."expiresAt">now()
      AND o."ownerId"=(SELECT auth.uid())::text
      AND private.verity_organization_has_capability(o.id,'VERIFY_CREDENTIALS')
  )
);

DROP POLICY IF EXISTS verity_certificate_grant_insert_org ON public."CertificateAccessGrant";
CREATE POLICY verity_certificate_grant_insert_org
ON public."CertificateAccessGrant" FOR INSERT TO authenticated
WITH CHECK (
  "requestedBy"=(SELECT auth.uid())::text
  AND status='PENDING'
  AND EXISTS (
    SELECT 1 FROM public."Organization" o
    WHERE o.id="CertificateAccessGrant"."organizationId"
      AND o."ownerId"=(SELECT auth.uid())::text
      AND o.status='APPROVED'
      AND private.verity_organization_has_capability(o.id,'VERIFY_CREDENTIALS')
  )
  AND EXISTS (
    SELECT 1 FROM public."Certificate" c
    WHERE c.id="CertificateAccessGrant"."certificateId"
      AND c."graduateId"="CertificateAccessGrant"."graduateId"
  )
);

DROP POLICY IF EXISTS verity_certificate_issuance_batch_owner_read ON public."CertificateIssuanceBatch";
CREATE POLICY verity_certificate_issuance_batch_owner_read
ON public."CertificateIssuanceBatch" FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public."Organization" o
    WHERE o.id="CertificateIssuanceBatch"."organizationId"
      AND o."ownerId"=(SELECT auth.uid())::text
      AND private.verity_organization_has_capability(o.id,'ISSUE_CREDENTIALS')
  )
  OR (SELECT private.is_admin())
);

DROP POLICY IF EXISTS verity_certificate_issuance_item_owner_read ON public."CertificateIssuanceItem";
CREATE POLICY verity_certificate_issuance_item_owner_read
ON public."CertificateIssuanceItem" FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public."Organization" o
    WHERE o.id="CertificateIssuanceItem"."organizationId"
      AND o."ownerId"=(SELECT auth.uid())::text
      AND private.verity_organization_has_capability(o.id,'ISSUE_CREDENTIALS')
  )
  OR (SELECT private.is_admin())
);

DROP POLICY IF EXISTS verity_private_certificate_upload ON storage.objects;
CREATE POLICY verity_private_certificate_upload
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id='verity-certificates'
  AND EXISTS (
    SELECT 1 FROM public."Organization" o
    JOIN public."Certificate" c ON c."organizationId"=o.id
    WHERE o.id=(storage.foldername(name))[1]
      AND c.id=(storage.foldername(name))[2]
      AND o."ownerId"=(SELECT auth.uid())::text
      AND o.status='APPROVED'
      AND private.verity_organization_has_capability(o.id,'ISSUE_CREDENTIALS')
  )
);

DROP POLICY IF EXISTS verity_private_certificate_read ON storage.objects;
CREATE POLICY verity_private_certificate_read
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id='verity-certificates'
  AND EXISTS (
    SELECT 1
    FROM public."CertificateDocument" d
    JOIN public."Certificate" c
      ON c.id=d."certificateId" AND c."organizationId"=d."organizationId"
    WHERE d."storagePath"=objects.name
      AND d."organizationId"=(storage.foldername(objects.name))[1]
      AND d."certificateId"=(storage.foldername(objects.name))[2]
      AND (
        (SELECT private.is_admin())
        OR EXISTS (
          SELECT 1 FROM public."Organization" o
          WHERE o.id=d."organizationId"
            AND o."ownerId"=(SELECT auth.uid())::text
            AND o.status='APPROVED'
        )
        OR c."graduateId"=(SELECT auth.uid())::text
        OR private.is_active_org_staff(d."organizationId",'documents:download')
      )
  )
);

DROP POLICY IF EXISTS verity_storage_granted_verifier_read ON storage.objects;
CREATE POLICY verity_storage_granted_verifier_read
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id='verity-certificates'
  AND EXISTS (
    SELECT 1
    FROM public."CertificateDocument" d
    JOIN public."Certificate" c
      ON c.id=d."certificateId" AND c."organizationId"=d."organizationId"
    JOIN public."CertificateAccessGrant" g ON g."certificateId"=d."certificateId"
    JOIN public."Organization" o ON o.id=g."organizationId"
    WHERE d."storagePath"=objects.name
      AND d."organizationId"=(storage.foldername(objects.name))[1]
      AND d."certificateId"=(storage.foldername(objects.name))[2]
      AND g.status='APPROVED' AND g."expiresAt">now()
      AND c.status='ACTIVE'
      AND o."ownerId"=(SELECT auth.uid())::text
      AND private.verity_organization_has_capability(o.id,'VERIFY_CREDENTIALS')
  )
);

-- ---------------------------------------------------------------------------
-- Capability-aware database functions used by student onboarding and verify
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.request_verity_membership(
  p_registration_code text,
  p_student_number text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_org public."Organization"%rowtype;
  v_user public."User"%rowtype;
  v_id text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_user from public."User" where id=auth.uid()::text;
  if not found or v_user.role <> 'GRADUATE'::public."Role" then
    raise exception 'Only graduate accounts can request organization membership';
  end if;
  select * into v_org from public."Organization"
    where upper("registrationCode")=upper(trim(p_registration_code));
  if not found or v_org.status <> 'APPROVED'
     or not private.verity_organization_has_capability(v_org.id,'ISSUE_CREDENTIALS') then
    raise exception 'Organization code is invalid or the organization is not approved to manage graduate records';
  end if;
  if v_org."registrationCodeExpiryEnabled"
     and (v_org."registrationCodeExpiresAt" is null or v_org."registrationCodeExpiresAt" <= now()) then
    raise exception 'This organization registration code has expired. Contact the organization administrator.';
  end if;
  insert into public."Membership"(id,"organizationId","userId","studentNumber",status)
  values(gen_random_uuid()::text,v_org.id,auth.uid()::text,nullif(trim(p_student_number),''),'PENDING')
  on conflict ("organizationId","userId") do update
    set "studentNumber"=excluded."studentNumber","updatedAt"=now()
  returning id into v_id;
  return jsonb_build_object('requested',true,'membershipId',v_id,'organizationName',v_org.name,'status','PENDING');
end;
$function$;

CREATE OR REPLACE FUNCTION public.verity_student_registration_precheck(
  p_organization_id text,
  p_student_number text
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
 select exists(
  select 1 from public."Organization" o
  join public."StudentRoster" r on r."organizationId"=o.id
  where o.id=p_organization_id
    and o.status='APPROVED'
    and o."directoryVisible" is true
    and private.verity_organization_has_capability(o.id,'ISSUE_CREDENTIALS')
    and r."normalizedStudentNumber"=upper(regexp_replace(trim(coalesce(p_student_number,'')),'[[:space:]]+','','g'))
    and r.status='ELIGIBLE' and r."claimedUserId" is null
 );
$function$;

CREATE OR REPLACE FUNCTION public.verity_student_signup_institutions()
RETURNS TABLE(id text, name text, "locationCity" text, "locationState" text, "locationCountry" text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
 select o.id,o.name,o."locationCity",o."locationState",o."locationCountry"
 from public."Organization" o
 where o.status='APPROVED'
   and o."directoryVisible" is true
   and private.verity_organization_has_capability(o.id,'ISSUE_CREDENTIALS')
 order by o.name limit 500;
$function$;

CREATE OR REPLACE FUNCTION public.activate_verity_student_roster(
  p_organization_id text,
  p_student_number text,
  p_token_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
 v_user public."User"%rowtype;
 v_org public."Organization"%rowtype;
 v_roster public."StudentRoster"%rowtype;
 v_token public."StudentActivationToken"%rowtype;
 v_membership_id text;
 v_number text;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select * into v_user from public."User" where id=auth.uid()::text;
 if not found or v_user.role <> 'GRADUATE'::public."Role" then
   raise exception 'Only graduate accounts can activate a student or employee record';
 end if;
 select * into v_org from public."Organization"
 where id=p_organization_id and status='APPROVED'
   and private.verity_organization_has_capability(id,'ISSUE_CREDENTIALS');
 if not found then raise exception 'Organization is unavailable for graduate activation'; end if;
 v_number=upper(regexp_replace(trim(coalesce(p_student_number,'')),'[[:space:]]+','','g'));
 if length(v_number)<2 or length(v_number)>80 then raise exception 'Enter a valid student or employee number'; end if;
 select * into v_roster from public."StudentRoster"
 where "organizationId"=v_org.id and "normalizedStudentNumber"=v_number for update;
 if not found then raise exception 'The record could not be verified. Contact the organization administrator.'; end if;
 if v_roster.status='ACTIVE' and v_roster."claimedUserId" is not null then
  if v_roster."claimedUserId"=auth.uid()::text then
   return jsonb_build_object('activated',true,'alreadyLinked',true,'institutionName',v_org.name);
  end if;
  raise exception 'This record is already linked. Contact the organization administrator for an identity review.';
 end if;
 if v_roster.status not in ('ELIGIBLE','CLAIM_PENDING') then
  raise exception 'This record is not available for self-activation. Contact the organization administrator.';
 end if;
 select * into v_token from public."StudentActivationToken"
 where "rosterId"=v_roster.id and "organizationId"=v_org.id for update;
 if not found or v_token."tokenHash"<>p_token_hash or v_token."usedAt" is not null
   or v_token."revokedAt" is not null
   or (v_token."expiresAt" is not null and v_token."expiresAt"<=now()) then
  raise exception 'The activation token is invalid, already used or no longer active. Contact the organization administrator.';
 end if;
 update public."StudentActivationToken"
 set "usedAt"=now(),"usedBy"=auth.uid()::text where id=v_token.id;
 update public."StudentRoster"
 set status='ACTIVE',"claimedUserId"=auth.uid()::text,"claimedAt"=now(),"updatedAt"=now()
 where id=v_roster.id;
 update public."User" set "fullName"=v_roster."fullName" where id=auth.uid()::text;
 insert into public."Membership"(id,"organizationId","userId","studentNumber",status)
 values(gen_random_uuid()::text,v_org.id,auth.uid()::text,v_roster."studentNumber",'ACTIVE')
 on conflict ("organizationId","userId") do update
 set "studentNumber"=excluded."studentNumber",status='ACTIVE',"updatedAt"=now()
 returning id into v_membership_id;
 return jsonb_build_object('activated',true,'membershipId',v_membership_id,'institutionName',v_org.name,'studentNumber',v_roster."studentNumber");
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_verity_student_roster(
  p_organization_id text,
  p_search text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
 v_org public."Organization"%rowtype;
 v_rows jsonb;
 v_counts jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select o.* into v_org from public."Organization" o
 where o.id=p_organization_id and o.status='APPROVED'
   and private.verity_organization_has_capability(o.id,'ISSUE_CREDENTIALS')
   and (
     o."ownerId"=auth.uid()::text
     or exists(
       select 1 from public."InstitutionICTStaff" i
       where i."organizationId"=o.id and i."userId"=auth.uid()::text
         and i.status='ACTIVE' and 'roster:manage'=any(i.permissions)
     )
   );
 if not found then raise exception 'Approved issuer roster-management permission is required'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',x.id,'studentNumber',x."studentNumber",'fullName',x."fullName",
  'institutionalEmail',x."institutionalEmail",'faculty',x.faculty,
  'department',x.department,'programme',x.programme,'academicSession',x."academicSession",
  'status',x.status,'claimedUserId',x."claimedUserId",'claimedAt',x."claimedAt",
  'createdAt',x."createdAt",
  'claimedBy',case when x."claimantId" is null then null else jsonb_build_object(
   'id',x."claimantId",'fullName',x."claimantName",'email',x."claimantEmail"
  ) end
 ) order by x."createdAt" desc),'[]'::jsonb) into v_rows
 from (
  select r.*,u.id as "claimantId",u."fullName" as "claimantName",u.email as "claimantEmail"
  from public."StudentRoster" r left join public."User" u on u.id=r."claimedUserId"
  where r."organizationId"=v_org.id
   and (nullif(trim(coalesce(p_search,'')),'') is null
    or r."studentNumber" ilike '%'||trim(p_search)||'%'
    or r."fullName" ilike '%'||trim(p_search)||'%')
  order by r."createdAt" desc limit 500
 ) x;
 select coalesce(jsonb_object_agg(status,total),'{}'::jsonb) into v_counts
 from (select r.status,count(*)::int as total from public."StudentRoster" r
       where r."organizationId"=v_org.id group by r.status) counts;
 return jsonb_build_object('organization',jsonb_build_object(
  'id',v_org.id,'name',v_org.name,'registrationCode',v_org."registrationCode",
  'registrationCodeExpiryEnabled',v_org."registrationCodeExpiryEnabled",
  'registrationCodeExpiresAt',v_org."registrationCodeExpiresAt"
 ),'students',v_rows,'counts',v_counts);
end;
$function$;

CREATE OR REPLACE FUNCTION public.lookup_verity_certificate_for_org(p_certificate_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_org public."Organization"%rowtype;
  c public."Certificate"%rowtype;
  v_user public."User"%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  select * into v_org from public."Organization"
  where "ownerId"=auth.uid()::text and status='APPROVED'
  limit 1;
  if not found or not private.verity_organization_has_capability(v_org.id,'VERIFY_CREDENTIALS') then
    raise exception 'Only an approved organization with verifier permission can use this endpoint.';
  end if;
  select * into c from public."Certificate"
  where "certificateId"=trim(p_certificate_id)
     or "verificationKey"=upper(trim(p_certificate_id))
  limit 1;
  if not found then return jsonb_build_object('found',false); end if;
  select * into v_user from public."User" where id=auth.uid()::text;
  insert into public."Verification"
    ("id","certificateId","verifierName","verifierOrg","result","createdAt","organizationId")
  values(gen_random_uuid()::text,c.id,left(v_user."fullName",200),
    left(v_org.name,200),'ORGANIZATION_LOOKUP',now(),v_org.id);
  return jsonb_build_object(
    'found',true,'certificateId',c."certificateId",'verificationKey',c."verificationKey",
    'studentName',c."studentName",'studentNumber',c."studentNumber",'institution',c.institution,
    'faculty',c.faculty,'department',c.department,'programme',c.programme,
    'qualification',c.qualification,'classification',c.classification,
    'awardDate',c."awardDate",'issuedAt',c."issuedAt",'digest',c.digest,
    'txHash',c."txHash",'status',c.status
  );
end;
$function$;

COMMENT ON FUNCTION private.verity_organization_has_capability(text,text) IS
  'Returns true only when an organization is approved and the requested capability has been independently approved.';
