-- VERITY Issue Resolution Centre
-- Applied to Supabase project fnsnhasnjmvodkwmdqkc on 2026-11-22.
create table if not exists public."IssueReport" (
  "id" text primary key,
  "ticketNumber" text not null unique,
  "reporterId" text not null references public."User"("id") on delete restrict,
  "organizationId" text references public."Organization"("id") on delete set null,
  "category" text not null check ("category" in ('ACCOUNT','CERTIFICATE','VERIFICATION','DOCUMENT_UPLOAD','ACCESS','DATA_CORRECTION','PERFORMANCE','OTHER')),
  "severity" text not null default 'NORMAL' check ("severity" in ('LOW','NORMAL','HIGH','CRITICAL')),
  "subject" text not null check (char_length("subject") between 5 and 140),
  "description" text not null check (char_length("description") between 15 and 4000),
  "status" text not null default 'OPEN' check ("status" in ('OPEN','IN_PROGRESS','WAITING_FOR_USER','RESOLVED','CLOSED')),
  "resolutionNotes" text,
  "assignedTo" text references public."User"("id") on delete set null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  "resolvedAt" timestamptz
);
create index if not exists "IssueReport_reporter_created_idx" on public."IssueReport" ("reporterId","createdAt" desc);
create index if not exists "IssueReport_org_created_idx" on public."IssueReport" ("organizationId","createdAt" desc);
create index if not exists "IssueReport_status_created_idx" on public."IssueReport" ("status","createdAt" desc);
alter table public."IssueReport" enable row level security;
create policy "Issue reports visible to reporter admins and organization owners" on public."IssueReport" for select to authenticated using (
 "reporterId"=(select auth.uid())::text
 or exists(select 1 from public."User" u where u.id=(select auth.uid())::text and u.role='ADMIN')
 or exists(select 1 from public."Organization" o where o.id="IssueReport"."organizationId" and o."ownerId"=(select auth.uid())::text)
);
create policy "Users can submit their own issue reports" on public."IssueReport" for insert to authenticated with check (
 "reporterId"=(select auth.uid())::text and "status"='OPEN' and "resolutionNotes" is null and "assignedTo" is null and ("organizationId" is null or exists(select 1 from public."Organization" o where o.id="IssueReport"."organizationId" and o."ownerId"=(select auth.uid())::text))
);
create policy "Admins and organization owners can update visible issue reports" on public."IssueReport" for update to authenticated using (
 exists(select 1 from public."User" u where u.id=(select auth.uid())::text and u.role='ADMIN')
 or exists(select 1 from public."Organization" o where o.id="IssueReport"."organizationId" and o."ownerId"=(select auth.uid())::text)
) with check (
 exists(select 1 from public."User" u where u.id=(select auth.uid())::text and u.role='ADMIN')
 or exists(select 1 from public."Organization" o where o.id="IssueReport"."organizationId" and o."ownerId"=(select auth.uid())::text)
);
grant select,insert on public."IssueReport" to authenticated;
revoke update on public."IssueReport" from authenticated;
grant update ("status","updatedAt","resolvedAt") on public."IssueReport" to authenticated;
