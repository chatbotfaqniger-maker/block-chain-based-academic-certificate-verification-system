create table if not exists public."StudentActivationToken" (
 "id" text primary key default gen_random_uuid()::text,
 "organizationId" text not null references public."Organization"("id") on delete cascade,
 "rosterId" text not null unique references public."StudentRoster"("id") on delete cascade,
 "tokenHash" text not null unique,
 "tokenLastFour" text not null,
 "issuedBy" text not null references public."User"("id"),
 "createdAt" timestamptz not null default now(),
 "expiresAt" timestamptz,
 "usedAt" timestamptz,
 "usedBy" text references public."User"("id"),
 "revokedAt" timestamptz
);
-- RLS, token controls and atomic claim function are applied in Supabase migration student_activation_tokens_and_atomic_roster_claim.
