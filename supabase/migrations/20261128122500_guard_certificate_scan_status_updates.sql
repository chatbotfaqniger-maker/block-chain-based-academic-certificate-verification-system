create or replace function private.guard_certificate_document_scan_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new."scanStatus" is distinct from old."scanStatus"
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Certificate document scan status is managed by the verified scanner service only';
  end if;
  return new;
end;
$$;

drop trigger if exists certificate_document_scan_status_guard on public."CertificateDocument";
create trigger certificate_document_scan_status_guard
before update on public."CertificateDocument"
for each row execute function private.guard_certificate_document_scan_status();

revoke all on function private.guard_certificate_document_scan_status() from public;
grant execute on function private.guard_certificate_document_scan_status() to authenticated, service_role;
