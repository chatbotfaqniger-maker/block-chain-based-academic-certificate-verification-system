-- Enforce the implemented organization-staff permission boundary at the database layer.
-- Staff may only receive certificates:read and documents:download.
-- A download permission always requires read permission.
begin;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'organization_staff_permissions_supported'
      and conrelid = 'public."OrganizationStaff"'::regclass
  ) then
    alter table public."OrganizationStaff"
      add constraint organization_staff_permissions_supported
      check (
        cardinality("permissions") between 1 and 2
        and "permissions" <@ array['certificates:read','documents:download']::text[]
        and (
          not ("permissions" @> array['documents:download']::text[])
          or "permissions" @> array['certificates:read']::text[]
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'organization_staff_status_supported'
      and conrelid = 'public."OrganizationStaff"'::regclass
  ) then
    alter table public."OrganizationStaff"
      add constraint organization_staff_status_supported
      check ("status" in ('ACTIVE','SUSPENDED'));
  end if;
end $$;

create index if not exists organization_staff_user_org_status_idx
  on public."OrganizationStaff" ("userId","organizationId","status");

commit;