-- VERITY private support conversations
-- Applied to Supabase project fnsnhasnjmvodkwmdqkc on 2026-11-22.
create table if not exists public."IssueMessage" (
 "id" text primary key,
 "issueId" text not null references public."IssueReport"("id") on delete cascade,
 "authorId" text not null references public."User"("id") on delete restrict,
 "authorName" text,
 "authorRole" text,
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

-- Author display snapshots are populated by the authenticated server route.


-- Support chat attachments: private bucket, participant-scoped object access.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('verity-support-attachments','verity-support-attachments',false,10485760,
 array['image/jpeg','image/png','image/webp','application/pdf','text/plain','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public=false,file_size_limit=10485760,allowed_mime_types=excluded.allowed_mime_types;

alter table public."IssueMessage"
 add column if not exists "attachments" jsonb not null default '[]'::jsonb;

create index if not exists "IssueMessage_attachments_gin_idx"
 on public."IssueMessage" using gin ("attachments");

create policy "VERITY support participants can read attachments"
 on storage.objects for select to authenticated
 using (
  bucket_id='verity-support-attachments'
  and exists (
   select 1 from public."IssueReport" r
   where r.id=(storage.foldername(name))[1]
   and (
    r."reporterId"=(select auth.uid())::text
    or exists(select 1 from public."User" u where u.id=(select auth.uid())::text and u.role='ADMIN')
    or exists(select 1 from public."Organization" o where o.id=r."organizationId" and o."ownerId"=(select auth.uid())::text)
   )
  )
 );

create policy "VERITY participants can upload support attachments"
 on storage.objects for insert to authenticated
 with check (
  bucket_id='verity-support-attachments'
  and (storage.foldername(name))[2]=(select auth.uid())::text
  and exists (
   select 1 from public."IssueReport" r
   where r.id=(storage.foldername(name))[1]
   and r.status<>'CLOSED'
   and (
    r."reporterId"=(select auth.uid())::text
    or exists(select 1 from public."User" u where u.id=(select auth.uid())::text and u.role='ADMIN')
    or exists(select 1 from public."Organization" o where o.id=r."organizationId" and o."ownerId"=(select auth.uid())::text)
   )
  )
 );
