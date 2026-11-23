-- Minimal Supabase-role/function fixture for the RPC privilege migration test.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='postgres') THEN CREATE ROLE postgres NOLOGIN SUPERUSER; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, postgres;
GRANT CREATE ON SCHEMA public TO postgres;

CREATE FUNCTION public.activate_verity_student_roster(text,text,text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN; END $$;
CREATE FUNCTION public.complete_verity_student_recovery(text,text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN; END $$;
CREATE FUNCTION public.list_verity_student_recovery_cases(text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN; END $$;
CREATE FUNCTION public.list_verity_student_roster(text,text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN; END $$;
CREATE FUNCTION public.lookup_verity_certificate(text,text,text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN; END $$;
CREATE FUNCTION public.lookup_verity_certificate_for_org(text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN; END $$;
CREATE FUNCTION public.request_verity_membership(text,text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN; END $$;
CREATE FUNCTION public.review_verity_student_recovery(text,text,text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN; END $$;
CREATE FUNCTION public.set_verity_organization_directory_visibility(boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN; END $$;
CREATE FUNCTION public.verify_verity_certificate_ledger(text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN; END $$;
CREATE FUNCTION public.verity_public_certificate_issuer(text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN; END $$;
CREATE FUNCTION public.verity_public_organization_directory(text,text,text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN; END $$;
CREATE FUNCTION public.verity_student_registration_precheck(text,text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN; END $$;
CREATE FUNCTION public.verity_student_signup_institutions() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN; END $$;
CREATE FUNCTION public.handle_new_verity_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN NEW; END $$;
CREATE FUNCTION public.verity_append_certificate_ledger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN NEW; END $$;
CREATE FUNCTION public.verity_prevent_ledger_mutation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN OLD; END $$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
