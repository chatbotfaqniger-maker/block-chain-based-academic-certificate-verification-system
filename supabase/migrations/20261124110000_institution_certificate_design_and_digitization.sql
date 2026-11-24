-- VERITY institution certificate design system.
-- Templates and digitisation reviews are institution-scoped, private, and additive.
create table if not exists public."InstitutionCertificateTemplate" (
  id text primary key,
  "organizationId" text not null references public."Organization"(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  "sourceType" text not null check ("sourceType" in ('VERITY_TEMPLATE','INSTITUTION_ARTWORK')),
  "templateKey" text,
  "assetStoragePath" text,
  "assetMimeType" text check ("assetMimeType" is null or "assetMimeType" in ('application/pdf','image/jpeg','image/png')),
  "assetSha256" text check ("assetSha256" is null or "assetSha256" ~ '^[a-f0-9]{64}$'),
  "pageSize" text not null default 'A4_LANDSCAPE' check ("pageSize" in ('A4_LANDSCAPE','A4_PORTRAIT','LETTER_LANDSCAPE','LETTER_PORTRAIT')),
  "fieldLayout" jsonb not null default '{}'::jsonb check (jsonb_typeof("fieldLayout")='object'),
  version integer not null default 1 check (version > 0),
  "isDefault" boolean not null default false,
  status text not null default 'DRAFT' check (status in ('DRAFT','ACTIVE','ARCHIVED')),
  "createdBy" text not null references public."User"(id),
  "updatedBy" text not null references public."User"(id),
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint "InstitutionCertificateTemplate_asset_consistent"
    check (
      ("sourceType"='VERITY_TEMPLATE' and "templateKey" is not null and "assetStoragePath" is null and "assetSha256" is null)
      or
      ("sourceType"='INSTITUTION_ARTWORK' and "templateKey" is null and "assetStoragePath" is not null and "assetMimeType" is not null and "assetSha256" is not null)
    )
);
create index if not exists "InstitutionCertificateTemplate_org_status_idx"
  on public."InstitutionCertificateTemplate" ("organizationId",status,"updatedAt" desc);
create unique index if not exists "InstitutionCertificateTemplate_one_default_per_org"
  on public."InstitutionCertificateTemplate" ("organizationId") where "isDefault" and status='ACTIVE';

create table if not exists public."CertificateDigitizationCase" (
  id text primary key,
  "organizationId" text not null references public."Organization"(id) on delete cascade,
  "submittedBy" text not null references public."User"(id),
  "reviewedBy" text references public."User"(id),
  "studentNumber" text not null check (char_length(btrim("studentNumber")) between 2 and 80),
  "claimedStudentName" text not null check (char_length(btrim("claimedStudentName")) between 2 and 180),
  "credentialData" jsonb not null check (jsonb_typeof("credentialData")='object'),
  "sourceStoragePath" text not null,
  "sourceFileName" text not null check (char_length(btrim("sourceFileName")) between 1 and 180),
  "sourceMimeType" text not null check ("sourceMimeType" in ('application/pdf','image/jpeg','image/png')),
  "sourceSizeBytes" bigint not null check ("sourceSizeBytes" between 1 and 10485760),
  "sourceSha256" text not null check ("sourceSha256" ~ '^[a-f0-9]{64}$'),
  status text not null default 'PENDING_REVIEW'
    check (status in ('PENDING_REVIEW','APPROVED','REJECTED','ISSUED','CANCELLED')),
  "reviewNote" text check ("reviewNote" is null or char_length("reviewNote")<=1000),
  "certificateId" text references public."Certificate"("certificateId") on delete restrict,
  "createdAt" timestamptz not null default now(),
  "reviewedAt" timestamptz,
  "issuedAt" timestamptz,
  constraint "CertificateDigitizationCase_review_state_consistent"
    check (
      (status='PENDING_REVIEW' and "reviewedBy" is null and "reviewedAt" is null and "certificateId" is null)
      or (status in ('APPROVED','REJECTED') and "reviewedBy" is not null and "reviewedAt" is not null and "certificateId" is null)
      or (status='ISSUED' and "reviewedBy" is not null and "reviewedAt" is not null and "certificateId" is not null and "issuedAt" is not null)
      or (status='CANCELLED' and "certificateId" is null)
    )
);
create index if not exists "CertificateDigitizationCase_org_status_idx"
  on public."CertificateDigitizationCase" ("organizationId",status,"createdAt" desc);
create unique index if not exists "CertificateDigitizationCase_one_issued_record"
  on public."CertificateDigitizationCase" ("certificateId") where "certificateId" is not null;

alter table public."InstitutionCertificateTemplate" enable row level security;
alter table public."CertificateDigitizationCase" enable row level security;

drop policy if exists verity_institution_certificate_template_owner_read on public."InstitutionCertificateTemplate";
create policy verity_institution_certificate_template_owner_read
  on public."InstitutionCertificateTemplate" for select to authenticated
  using (
    exists(select 1 from public."Organization" o
      where o.id="InstitutionCertificateTemplate"."organizationId"
        and o."ownerId"=(select auth.uid())::text and o.type='INSTITUTION')
    or (select private.is_admin())
  );

drop policy if exists verity_certificate_digitization_case_owner_read on public."CertificateDigitizationCase";
create policy verity_certificate_digitization_case_owner_read
  on public."CertificateDigitizationCase" for select to authenticated
  using (
    exists(select 1 from public."Organization" o
      where o.id="CertificateDigitizationCase"."organizationId"
        and o."ownerId"=(select auth.uid())::text and o.type='INSTITUTION')
    or (select private.is_admin())
  );

revoke all on public."InstitutionCertificateTemplate" from public,anon,authenticated;
revoke all on public."CertificateDigitizationCase" from public,anon,authenticated;
grant select on public."InstitutionCertificateTemplate" to authenticated;
grant select on public."CertificateDigitizationCase" to authenticated;
grant select,insert,update on public."InstitutionCertificateTemplate" to service_role;
grant select,insert,update on public."CertificateDigitizationCase" to service_role;

comment on table public."InstitutionCertificateTemplate" is
  'Private institution-owned certificate designs. Artwork assets remain in the private verity-certificates bucket; the row stores a SHA-256 fingerprint and approved field layout.';
comment on table public."CertificateDigitizationCase" is
  'Private review queue for previously issued certificate scans. Uploading a scan never creates or verifies a credential; only an institution-reviewed and separately issued Certificate record is verifiable.';
