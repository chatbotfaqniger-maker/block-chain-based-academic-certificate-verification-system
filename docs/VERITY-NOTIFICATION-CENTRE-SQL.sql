-- VERITY Notification Centre tables and policies.
-- Applied to Supabase project fnsnhasnjmvodkwmdqkc.
create table if not exists public."Notification" (
 "id" text primary key default gen_random_uuid()::text,
 "userId" text not null references public."User"("id") on delete cascade,
 "type" text not null,
 "category" text not null,
 "title" text not null,
 "body" text not null,
 "url" text not null default '/',
 "metadata" jsonb not null default '{}'::jsonb,
 "readAt" timestamptz,
 "createdAt" timestamptz not null default now()
);
create index if not exists "Notification_user_created_idx" on public."Notification"("userId","createdAt" desc);
create index if not exists "Notification_user_unread_idx" on public."Notification"("userId","readAt") where "readAt" is null;
alter table public."Notification" enable row level security;
drop policy if exists "Users read own notifications" on public."Notification";
create policy "Users read own notifications" on public."Notification" for select to authenticated using ("userId"=(select auth.uid())::text);
drop policy if exists "Users update own notifications" on public."Notification";
create policy "Users update own notifications" on public."Notification" for update to authenticated using ("userId"=(select auth.uid())::text) with check ("userId"=(select auth.uid())::text);
revoke update on table public."Notification" from authenticated;
grant select on public."Notification" to authenticated;
grant update ("readAt") on public."Notification" to authenticated;

create table if not exists public."NotificationPreference" (
 "id" text primary key default gen_random_uuid()::text,
 "userId" text not null references public."User"("id") on delete cascade,
 "category" text not null,
 "inAppEnabled" boolean not null default true,
 "pushEnabled" boolean not null default true,
 "emailEnabled" boolean not null default false,
 "updatedAt" timestamptz not null default now(),
 unique("userId","category")
);
alter table public."NotificationPreference" enable row level security;
drop policy if exists "Users manage own notification preferences" on public."NotificationPreference";
create policy "Users manage own notification preferences" on public."NotificationPreference" for all to authenticated using ("userId"=(select auth.uid())::text) with check ("userId"=(select auth.uid())::text);
grant select,insert,update,delete on public."NotificationPreference" to authenticated;
