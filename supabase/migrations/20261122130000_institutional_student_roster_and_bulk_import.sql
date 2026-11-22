-- VERITY institutional roster and resumable bulk-import foundation.
-- Student roster records are not authentication accounts and do not grant certificate access.
create table if not exists public."StudentRoster" (
 id text primary key,
 "organizationId" text not null references public."Organization"(id) on delete cascade,
 "studentNumber" text not null,
 "fullName" text not null,
 email text,
 faculty text not null,
 department text not null,
 programme text not null,
 qualification text not null,
 classification text,
 "awardDate" date,
 status text not null default 'ACTIVE' check(status in ('ACTIVE','ARCHIVED')),
 "createdBy" text not null references public."User"(id),
 "createdAt" timestamptz not null default now(),
 "updatedAt" timestamptz not null default now(),
 constraint "StudentRoster_org_student_unique" unique("organizationId","studentNumber")
);
create index if not exists "StudentRoster_org_created_idx" on public."StudentRoster"("organizationId","createdAt" desc);
create index if not exists "StudentRoster_org_name_idx" on public."StudentRoster"("organizationId","fullName");
create index if not exists "StudentRoster_org_department_idx" on public."StudentRoster"("organizationId",department);
create table if not exists public."StudentImportBatch" (
 id text primary key,
 "organizationId" text not null references public."Organization"(id) on delete cascade,
 "fileName" text not null,
 "totalRows" integer not null check("totalRows">=0),
 "insertedRows" integer not null default 0 check("insertedRows">=0),
 "duplicateRows" integer not null default 0 check("duplicateRows">=0),
 "rejectedRows" integer not null default 0 check("rejectedRows">=0),
 status text not null default 'PROCESSING' check(status in ('PROCESSING','COMPLETED','PARTIAL','FAILED')),
 "errorSummary" jsonb not null default '[]'::jsonb,
 "createdBy" text not null references public."User"(id),
 "createdAt" timestamptz not null default now(),
 "completedAt" timestamptz
);
create index if not exists "StudentImportBatch_org_created_idx" on public."StudentImportBatch"("organizationId","createdAt" desc);
alter table public."StudentRoster" enable row level security;
alter table public."StudentImportBatch" enable row level security;

drop policy if exists verity_student_roster_owner_read on public."StudentRoster";
create policy verity_student_roster_owner_read on public."StudentRoster" for select to authenticated using (
 exists(select 1 from public."Organization" o where o.id="StudentRoster"."organizationId" and o."ownerId"=(select auth.uid())::text and o.type='INSTITUTION')
 or (select private.is_admin())
);
drop policy if exists verity_student_roster_owner_insert on public."StudentRoster";
create policy verity_student_roster_owner_insert on public."StudentRoster" for insert to authenticated with check (
 "createdBy"=(select auth.uid())::text and exists(select 1 from public."Organization" o where o.id="StudentRoster"."organizationId" and o."ownerId"=(select auth.uid())::text and o.type='INSTITUTION' and o.status='APPROVED')
);
drop policy if exists verity_student_roster_owner_update on public."StudentRoster";
create policy verity_student_roster_owner_update on public."StudentRoster" for update to authenticated using (
 exists(select 1 from public."Organization" o where o.id="StudentRoster"."organizationId" and o."ownerId"=(select auth.uid())::text and o.type='INSTITUTION')
) with check (
 exists(select 1 from public."Organization" o where o.id="StudentRoster"."organizationId" and o."ownerId"=(select auth.uid())::text and o.type='INSTITUTION')
);

drop policy if exists verity_student_import_owner_read on public."StudentImportBatch";
create policy verity_student_import_owner_read on public."StudentImportBatch" for select to authenticated using (
 exists(select 1 from public."Organization" o where o.id="StudentImportBatch"."organizationId" and o."ownerId"=(select auth.uid())::text and o.type='INSTITUTION')
 or (select private.is_admin())
);
drop policy if exists verity_student_import_owner_insert on public."StudentImportBatch";
create policy verity_student_import_owner_insert on public."StudentImportBatch" for insert to authenticated with check (
 "createdBy"=(select auth.uid())::text and exists(select 1 from public."Organization" o where o.id="StudentImportBatch"."organizationId" and o."ownerId"=(select auth.uid())::text and o.type='INSTITUTION' and o.status='APPROVED')
);
drop policy if exists verity_student_import_owner_update on public."StudentImportBatch";
create policy verity_student_import_owner_update on public."StudentImportBatch" for update to authenticated using (
 exists(select 1 from public."Organization" o where o.id="StudentImportBatch"."organizationId" and o."ownerId"=(select auth.uid())::text and o.type='INSTITUTION')
) with check (
 exists(select 1 from public."Organization" o where o.id="StudentImportBatch"."organizationId" and o."ownerId"=(select auth.uid())::text and o.type='INSTITUTION')
);
grant select,insert,update on public."StudentRoster" to authenticated;
grant select,insert,update on public."StudentImportBatch" to authenticated;
