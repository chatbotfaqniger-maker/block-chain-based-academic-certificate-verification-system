-- VERITY private support conversations
-- Applied to Supabase project fnsnhasnjmvodkwmdqkc on 2026-11-22.
create table if not exists public."IssueMessage" (
 "id" text primary key,
 "issueId" text not null references public."IssueReport"("id") on delete cascade,
 "authorId" text not null references public."User"("id") on delete restrict,
 "body" text not null check (char_length(trim("body")) between 1 and 5000),
 "createdAt" timestamptz not null default now()
);
create index if not exists "IssueMessage_issue_created_idx" on public."IssueMessage" ("issueId","createdAt");
alter table public."IssueMessage" enable row level security;
create policy "Issue participants can read conversation" on public."IssueMessage" for select to authenticated using (
 exists(select 1 from public."IssueReport" r where r.id="IssueMessage"."issueId" and (
  r."reporterId"=(select auth.uid())::text
  or exists(select 1 from public."User" u where u.id=(select auth.uid())::text and u.role='ADMIN')
  or exists(select 1 from public."Organization" o where o.id=r."organizationId" and o."ownerId"=(select auth.uid())::text)
 ))
);
create policy "Issue participants can send messages" on public."IssueMessage" for insert to authenticated with check (
 "authorId"=(select auth.uid())::text and exists(select 1 from public."IssueReport" r where r.id="IssueMessage"."issueId" and r."status" not in ('CLOSED') and (
  r."reporterId"=(select auth.uid())::text
  or exists(select 1 from public."User" u where u.id=(select auth.uid())::text and u.role='ADMIN')
  or exists(select 1 from public."Organization" o where o.id=r."organizationId" and o."ownerId"=(select auth.uid())::text)
 ))
);
grant select,insert on public."IssueMessage" to authenticated;
