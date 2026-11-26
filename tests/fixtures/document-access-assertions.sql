-- Apply the launch-policy migration before this file.
DO $$
DECLARE n integer;
BEGIN
  -- No unauthenticated/public read policy exists.
  PERFORM set_config('request.jwt.claim.sub','',true);
  SET LOCAL ROLE anon;
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='verity-certificates';
  IF n<>0 THEN RAISE EXCEPTION 'Anonymous users must not read private certificate files'; END IF;
  RESET ROLE;

  -- Institution owner can read its own unscanned private certificate.
  PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM storage.objects WHERE name='org-institution/cert-institution/file.pdf';
  IF n<>1 THEN RAISE EXCEPTION 'Approved institution owner must read its own unscanned document'; END IF;
  SELECT count(*) INTO n FROM storage.objects WHERE name='org-employer-issuer/cert-employer/file.pdf';
  IF n<>0 THEN RAISE EXCEPTION 'Institution owner must not read another issuer tenant'; END IF;
  RESET ROLE;

  -- Employer/organization issuers are also supported; no institution-only restriction.
  PERFORM set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM storage.objects WHERE name='org-employer-issuer/cert-employer/file.pdf';
  IF n<>1 THEN RAISE EXCEPTION 'Approved employer issuer owner must read its own unscanned document'; END IF;
  RESET ROLE;

  -- Graduate identity and active staff download permission remain valid.
  PERFORM set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000003',true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM storage.objects WHERE name='org-institution/cert-institution/file.pdf';
  IF n<>1 THEN RAISE EXCEPTION 'Graduate must read own linked certificate document'; END IF;
  RESET ROLE;

  PERFORM set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000004',true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM storage.objects WHERE name='org-institution/cert-institution/file.pdf';
  IF n<>1 THEN RAISE EXCEPTION 'Active staff with documents:download must read authorized document'; END IF;
  RESET ROLE;

  -- Admin authorization remains available.
  PERFORM set_config('request.jwt.claim.sub','50000000-0000-4000-8000-000000000005',true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM storage.objects WHERE name='org-institution/cert-institution/file.pdf';
  IF n<>1 THEN RAISE EXCEPTION 'VERITY admin must retain authorized document access'; END IF;
  RESET ROLE;

  -- Approved, unexpired graduate-consented verifier grant remains independent and intact.
  PERFORM set_config('request.jwt.claim.sub','60000000-0000-4000-8000-000000000006',true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM storage.objects WHERE name='org-institution/cert-institution/file.pdf';
  IF n<>1 THEN RAISE EXCEPTION 'Approved verifier with an unexpired graduate grant must read the shared document'; END IF;
  RESET ROLE;

  -- Expired grants do not grant access.
  PERFORM set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000007',true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM storage.objects WHERE name='org-institution/cert-expired/file.pdf';
  IF n<>0 THEN RAISE EXCEPTION 'Expired graduate-consent grant must not permit document access'; END IF;
  RESET ROLE;
END $$;
