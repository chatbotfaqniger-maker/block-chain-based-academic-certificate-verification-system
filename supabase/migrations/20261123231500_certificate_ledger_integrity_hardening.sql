-- VERITY certificate ledger integrity and public table permission hardening.
-- RLS does not apply to TRUNCATE; remove that privilege from all application roles.
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM anon, authenticated, service_role;

-- Keep future public tables from inheriting RLS-bypassing TRUNCATE privileges.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM anon, authenticated, service_role;

-- New public-schema functions created by either migration owner must not
-- inherit EXECUTE access for anon/authenticated. Service-side RPC grants are explicit.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

-- The ledger is written only by its owner-controlled certificate trigger.
REVOKE ALL ON TABLE public."CertificateLedger" FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public."CertificateLedger" FROM service_role;
GRANT SELECT ON TABLE public."CertificateLedger" TO service_role;

-- A certificate is an immutable issuance record. Its only permitted changes are:
-- one ACTIVE -> REVOKED transition, or one-time blockchain anchor metadata.
CREATE OR REPLACE FUNCTION public.verity_guard_certificate_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_payload text;
  v_expected_digest text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Certificate records cannot be deleted. Revoke the certificate instead.';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status::text <> 'ACTIVE' THEN
      RAISE EXCEPTION 'New certificates must start in ACTIVE status';
    END IF;
    IF NEW."revokedAt" IS NOT NULL OR NEW."revokeReason" IS NOT NULL THEN
      RAISE EXCEPTION 'A new certificate cannot contain revocation metadata';
    END IF;
    IF (
      (NEW."txHash" IS NULL AND NEW."chainId" IS NULL AND NEW."contractAddress" IS NULL)
      OR
      (
        NEW."txHash" IS NOT NULL
        AND length(NEW."txHash") = 66
        AND left(NEW."txHash", 2) = '0x'
        AND translate(substr(NEW."txHash", 3), '0123456789abcdefABCDEF', '') = ''
        AND NEW."chainId" IS NOT NULL
        AND length(NEW."chainId") > 0
        AND translate(NEW."chainId", '0123456789', '') = ''
        AND NEW."contractAddress" IS NOT NULL
        AND length(NEW."contractAddress") = 42
        AND left(NEW."contractAddress", 2) = '0x'
        AND translate(substr(NEW."contractAddress", 3), '0123456789abcdefABCDEF', '') = ''
      )
    ) IS NOT TRUE THEN
      RAISE EXCEPTION 'Blockchain anchor fields must be either all empty or a complete valid anchor';
    END IF;

    v_payload :=
      '{"certificateId":' || to_json(NEW."certificateId")::text ||
      ',"studentName":' || to_json(btrim(NEW."studentName"))::text ||
      ',"studentNumber":' || to_json(btrim(NEW."studentNumber"))::text ||
      ',"institution":' || to_json(btrim(NEW.institution))::text ||
      ',"faculty":' || to_json(btrim(NEW.faculty))::text ||
      ',"department":' || to_json(btrim(NEW.department))::text ||
      ',"programme":' || to_json(btrim(NEW.programme))::text ||
      ',"qualification":' || to_json(btrim(NEW.qualification))::text ||
      ',"classification":' || to_json(coalesce(NEW.classification, ''))::text ||
      ',"awardDate":' || to_json(to_char(NEW."awardDate", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text ||
      '}';
    v_expected_digest := encode(extensions.digest(convert_to(v_payload, 'UTF8'), 'sha256'), 'hex');
    IF NEW.digest IS DISTINCT FROM v_expected_digest THEN
      RAISE EXCEPTION 'Certificate SHA-256 fingerprint does not match its canonical academic record';
    END IF;
    RETURN NEW;
  END IF;

  -- All fields not explicitly listed below are immutable, including the
  -- certificate ID, verification key, academic record, issuer, organization,
  -- graduate, digest and (when present) bulk issuance item reference.
  IF (to_jsonb(NEW) - ARRAY['status','revokedAt','revokeReason','updatedAt','txHash','chainId','contractAddress'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status','revokedAt','revokeReason','updatedAt','txHash','chainId','contractAddress']) THEN
    RAISE EXCEPTION 'Issued certificate identity, academic details and fingerprint are immutable';
  END IF;

  -- Do not allow status changes on a record whose original fingerprint no
  -- longer matches its academic fields.
  v_payload :=
    '{"certificateId":' || to_json(OLD."certificateId")::text ||
    ',"studentName":' || to_json(btrim(OLD."studentName"))::text ||
    ',"studentNumber":' || to_json(btrim(OLD."studentNumber"))::text ||
    ',"institution":' || to_json(btrim(OLD.institution))::text ||
    ',"faculty":' || to_json(btrim(OLD.faculty))::text ||
    ',"department":' || to_json(btrim(OLD.department))::text ||
    ',"programme":' || to_json(btrim(OLD.programme))::text ||
    ',"qualification":' || to_json(btrim(OLD.qualification))::text ||
    ',"classification":' || to_json(coalesce(OLD.classification, ''))::text ||
    ',"awardDate":' || to_json(to_char(OLD."awardDate", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text ||
    '}';
  v_expected_digest := encode(extensions.digest(convert_to(v_payload, 'UTF8'), 'sha256'), 'hex');
  IF OLD.digest IS DISTINCT FROM v_expected_digest THEN
    RAISE EXCEPTION 'Existing certificate fingerprint mismatch; manual integrity review is required';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status::text <> 'ACTIVE' OR NEW.status::text <> 'REVOKED' THEN
      RAISE EXCEPTION 'The only permitted certificate status transition is ACTIVE to REVOKED';
    END IF;
    IF OLD."revokedAt" IS NOT NULL OR OLD."revokeReason" IS NOT NULL THEN
      RAISE EXCEPTION 'Revocation metadata is already set and cannot be replaced';
    END IF;
    IF NEW."revokedAt" IS NULL THEN
      NEW."revokedAt" := now();
    END IF;
    IF length(btrim(coalesce(NEW."revokeReason", ''))) < 3 THEN
      RAISE EXCEPTION 'A meaningful revocation reason is required';
    END IF;
  ELSE
    IF NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt"
       OR NEW."revokeReason" IS DISTINCT FROM OLD."revokeReason" THEN
      RAISE EXCEPTION 'Revocation metadata can only be set during the ACTIVE to REVOKED transition';
    END IF;
  END IF;

  IF (NEW."txHash", NEW."chainId", NEW."contractAddress")
     IS DISTINCT FROM
     (OLD."txHash", OLD."chainId", OLD."contractAddress") THEN
    IF (
      OLD."txHash" IS NULL AND OLD."chainId" IS NULL AND OLD."contractAddress" IS NULL
      AND NEW."txHash" IS NOT NULL
      AND length(NEW."txHash") = 66
      AND left(NEW."txHash", 2) = '0x'
      AND translate(substr(NEW."txHash", 3), '0123456789abcdefABCDEF', '') = ''
      AND NEW."chainId" IS NOT NULL
      AND length(NEW."chainId") > 0
      AND translate(NEW."chainId", '0123456789', '') = ''
      AND NEW."contractAddress" IS NOT NULL
      AND length(NEW."contractAddress") = 42
      AND left(NEW."contractAddress", 2) = '0x'
      AND translate(substr(NEW."contractAddress", 3), '0123456789abcdefABCDEF', '') = ''
    ) IS NOT TRUE THEN
      RAISE EXCEPTION 'Blockchain anchor metadata may be attached once and cannot later be changed';
    END IF;
  END IF;

  NEW."updatedAt" := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS verity_guard_certificate_record ON public."Certificate";
CREATE TRIGGER verity_guard_certificate_record
  BEFORE INSERT OR UPDATE OR DELETE ON public."Certificate"
  FOR EACH ROW EXECUTE FUNCTION public.verity_guard_certificate_record();

REVOKE ALL ON FUNCTION public.verity_guard_certificate_record() FROM PUBLIC, anon, authenticated, service_role;

-- Return both the hash-chain result and whether the latest ledger event still
-- describes the current certificate row. This prevents a valid chain from
-- being mistaken for proof that a mutable row still matches its issuance.
CREATE OR REPLACE FUNCTION public.verify_verity_certificate_ledger_record(p_certificate_id text)
RETURNS TABLE (
  ledger_valid boolean,
  event_count bigint,
  latest_event text,
  head_hash text,
  record_matches boolean
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_certificate public."Certificate"%ROWTYPE;
  v_base record;
  v_latest public."CertificateLedger"%ROWTYPE;
  v_has_latest boolean := false;
  v_record_matches boolean := false;
BEGIN
  SELECT * INTO v_certificate
  FROM public."Certificate"
  WHERE "certificateId" = trim(coalesce(p_certificate_id, ''))
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0::bigint, NULL::text, NULL::text, false;
    RETURN;
  END IF;

  SELECT * INTO v_base
  FROM public.verify_verity_certificate_ledger(v_certificate."certificateId")
  LIMIT 1;

  SELECT * INTO v_latest
  FROM public."CertificateLedger"
  WHERE "certificateCode" = v_certificate."certificateId"
  ORDER BY id DESC
  LIMIT 1;
  v_has_latest := FOUND;

  v_record_matches := v_has_latest
    AND v_latest."eventData"->>'certificateId' = v_certificate."certificateId"
    AND v_latest."eventData"->>'digest' = v_certificate.digest
    AND v_latest."eventData"->>'status' = v_certificate.status::text
    AND v_latest."eventType" = CASE
      WHEN v_certificate.status::text = 'ACTIVE' THEN 'ISSUED'
      WHEN v_certificate.status::text = 'REVOKED' THEN 'REVOKED'
      ELSE NULL
    END;

  RETURN QUERY SELECT
    coalesce(v_base.ledger_valid, false),
    coalesce(v_base.event_count, 0)::bigint,
    v_base.latest_event,
    v_base.head_hash,
    coalesce(v_record_matches, false);
END;
$$;

REVOKE ALL ON FUNCTION public.verify_verity_certificate_ledger_record(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_verity_certificate_ledger_record(text) TO service_role;

-- These internal RPCs run as the explicitly authorized service_role. They do not
-- need SECURITY DEFINER because service_role already has the required table
-- privileges and bypasses RLS. Keep only the append trigger privileged.
ALTER FUNCTION public.lookup_verity_certificate(text, text, text) SECURITY INVOKER;
ALTER FUNCTION public.verify_verity_certificate_ledger(text) SECURITY INVOKER;
ALTER FUNCTION public.verity_student_registration_precheck(text, text) SECURITY INVOKER;

-- Public callers must go through the rate-limited Express API. These
-- SECURITY DEFINER RPCs are internal server operations, not public REST APIs.
REVOKE ALL ON FUNCTION public.lookup_verity_certificate(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_verity_certificate(text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.verify_verity_certificate_ledger(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_verity_certificate_ledger(text) TO service_role;

REVOKE ALL ON FUNCTION public.verity_student_registration_precheck(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verity_student_registration_precheck(text, text) TO service_role;

DO $$
DECLARE
  v_truncate_count integer;
BEGIN
  SELECT count(*) INTO v_truncate_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND (
      has_table_privilege('anon', c.oid, 'TRUNCATE')
      OR has_table_privilege('authenticated', c.oid, 'TRUNCATE')
      OR has_table_privilege('service_role', c.oid, 'TRUNCATE')
    );
  IF v_truncate_count > 0 THEN
    RAISE EXCEPTION 'VERITY security hardening failed: application roles still have TRUNCATE on % public tables', v_truncate_count;
  END IF;
  IF has_table_privilege('service_role', 'public."CertificateLedger"', 'INSERT')
     OR has_table_privilege('service_role', 'public."CertificateLedger"', 'UPDATE')
     OR has_table_privilege('service_role', 'public."CertificateLedger"', 'DELETE')
     OR has_table_privilege('service_role', 'public."CertificateLedger"', 'TRUNCATE') THEN
    RAISE EXCEPTION 'VERITY certificate ledger must remain read-only to service_role';
  END IF;
END;
$$;
