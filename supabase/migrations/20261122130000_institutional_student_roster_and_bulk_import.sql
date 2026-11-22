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


-- Durable, resumable import queue. Rows are staged in Postgres before processing.
alter table public."StudentImportBatch"
  add column if not exists "totalChunks" integer not null default 0 check ("totalChunks" >= 0),
  add column if not exists "processedChunks" integer not null default 0 check ("processedChunks" >= 0),
  add column if not exists "failedChunks" integer not null default 0 check ("failedChunks" >= 0),
  add column if not exists "updatedAt" timestamptz not null default now();

alter table public."StudentImportBatch"
  drop constraint if exists "StudentImportBatch_status_check";
alter table public."StudentImportBatch"
  add constraint "StudentImportBatch_status_check"
  check (status in ('UPLOADING','QUEUED','PROCESSING','COMPLETED','PARTIAL','FAILED'));

create table if not exists public."StudentImportChunk" (
  id text primary key,
  "batchId" text not null references public."StudentImportBatch"(id) on delete cascade,
  "organizationId" text not null references public."Organization"(id) on delete cascade,
  "chunkIndex" integer not null check ("chunkIndex" >= 0),
  rows jsonb not null check (jsonb_typeof(rows) = 'array' and jsonb_array_length(rows) between 1 and 100),
  "contentHash" text not null check ("contentHash" ~ '^[a-f0-9]{64}$'),
  "createdBy" text not null references public."User"(id),
  status text not null default 'PENDING' check (status in ('PENDING','COMPLETED','FAILED')),
  attempts integer not null default 0 check (attempts >= 0),
  "errorMessage" text,
  "createdAt" timestamptz not null default now(),
  "processedAt" timestamptz,
  constraint "StudentImportChunk_batch_index_unique" unique ("batchId","chunkIndex")
);
create index if not exists "StudentImportChunk_pending_idx"
  on public."StudentImportChunk"("createdAt","batchId","chunkIndex") where status='PENDING';
alter table public."StudentImportChunk" enable row level security;

drop policy if exists verity_student_import_chunk_owner_read on public."StudentImportChunk";
create policy verity_student_import_chunk_owner_read on public."StudentImportChunk"
  for select to authenticated using (
    exists(select 1 from public."Organization" o
      where o.id="StudentImportChunk"."organizationId"
        and o."ownerId"=(select auth.uid())::text and o.type='INSTITUTION')
    or (select private.is_admin())
  );
drop policy if exists verity_student_import_chunk_owner_insert on public."StudentImportChunk";
create policy verity_student_import_chunk_owner_insert on public."StudentImportChunk"
  for insert to authenticated with check (
    "createdBy"=(select auth.uid())::text
    and exists(
      select 1 from public."Organization" o
      join public."StudentImportBatch" b on b."organizationId"=o.id
      where o.id="StudentImportChunk"."organizationId"
        and b.id="StudentImportChunk"."batchId"
        and b."createdBy"=(select auth.uid())::text
        and b.status='UPLOADING'
        and o."ownerId"=(select auth.uid())::text
        and o.type='INSTITUTION' and o.status='APPROVED'
    )
  );
grant select,insert on public."StudentImportChunk" to authenticated;
grant select,insert,update on public."StudentImportChunk" to service_role;
grant select,update on public."StudentImportBatch" to service_role;
grant select,insert,update on public."StudentRoster" to service_role;

-- One database transaction claims and processes one chunk. If the worker dies,
-- Postgres rolls the entire transaction back and the chunk remains pending.
create or replace function public.process_next_student_import_chunk()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_chunk public."StudentImportChunk"%rowtype;
  v_inserted integer := 0;
  v_total integer := 0;
  v_processed integer := 0;
  v_inserted_total integer := 0;
  v_duplicate_total integer := 0;
  v_failed_total integer := 0;
  v_rejected integer := 0;
  v_final_status text := 'PROCESSING';
  v_error text;
begin
  select c.* into v_chunk
  from public."StudentImportChunk" c
  join public."StudentImportBatch" b on b.id=c."batchId"
  where c.status='PENDING' and b.status in ('QUEUED','PROCESSING')
  order by c."createdAt", c."chunkIndex"
  for update of c skip locked
  limit 1;

  if not found then
    return jsonb_build_object('processed',false);
  end if;

  update public."StudentImportChunk"
    set attempts=attempts+1
    where id=v_chunk.id;

  v_total := jsonb_array_length(v_chunk.rows);

  begin
    insert into public."StudentRoster" (
      id,"organizationId","studentNumber","fullName",email,faculty,department,
      programme,qualification,classification,"awardDate","createdBy","createdAt","updatedAt"
    )
    select
      gen_random_uuid()::text,
      v_chunk."organizationId",
      upper(trim(x."studentNumber")),
      trim(x."fullName"),
      nullif(lower(trim(x.email)),''),
      trim(x.faculty),
      trim(x.department),
      trim(x.programme),
      trim(x.qualification),
      nullif(trim(x.classification),''),
      case when nullif(trim(x."awardDate"),'') is null then null
        else trim(x."awardDate")::date end,
      v_chunk."createdBy",
      now(),
      now()
    from jsonb_to_recordset(v_chunk.rows) as x(
      "studentNumber" text,"fullName" text,email text,faculty text,
      department text,programme text,qualification text,classification text,"awardDate" text
    )
    on conflict ("organizationId","studentNumber") do nothing;

    get diagnostics v_inserted = row_count;

    update public."StudentImportChunk"
      set status='COMPLETED', "processedAt"=now(), "errorMessage"=null
      where id=v_chunk.id;

    update public."StudentImportBatch"
      set "insertedRows"="insertedRows"+v_inserted,
          "duplicateRows"="duplicateRows"+(v_total-v_inserted),
          "processedChunks"="processedChunks"+1,
          status=case
            when "processedChunks"+1 >= "totalChunks" then
              case when "rejectedRows">0 or "failedChunks">0 or "duplicateRows"+(v_total-v_inserted)>0
                then 'PARTIAL' else 'COMPLETED' end
            else 'PROCESSING'
          end,
          "completedAt"=case when "processedChunks"+1 >= "totalChunks" then now() else null end,
          "updatedAt"=now()
      where id=v_chunk."batchId"
      returning "processedChunks","insertedRows","duplicateRows","failedChunks","rejectedRows",status
        into v_processed,v_inserted_total,v_duplicate_total,v_failed_total,v_rejected,v_final_status;

    return jsonb_build_object(
      'processed',true,'batchId',v_chunk."batchId",'chunkIndex',v_chunk."chunkIndex",
      'inserted',v_inserted,'duplicates',v_total-v_inserted,
      'processedChunks',v_processed,'insertedRows',v_inserted_total,
      'duplicateRows',v_duplicate_total,'failedChunks',v_failed_total,
      'rejectedRows',v_rejected,'status',v_final_status
    );
  exception when others then
    v_error := left(SQLERRM,300);
    update public."StudentImportChunk"
      set status='FAILED',"processedAt"=now(),"errorMessage"=v_error
      where id=v_chunk.id;
    update public."StudentImportBatch"
      set "failedChunks"="failedChunks"+1,
          "processedChunks"="processedChunks"+1,
          "errorSummary"="errorSummary" || jsonb_build_array(jsonb_build_object(
            'chunkIndex',v_chunk."chunkIndex",'message','Chunk processing failed: '||v_error
          )),
          status=case when "processedChunks"+1 >= "totalChunks" then 'PARTIAL' else 'PROCESSING' end,
          "completedAt"=case when "processedChunks"+1 >= "totalChunks" then now() else null end,
          "updatedAt"=now()
      where id=v_chunk."batchId"
      returning "processedChunks","insertedRows","duplicateRows","failedChunks","rejectedRows",status
        into v_processed,v_inserted_total,v_duplicate_total,v_failed_total,v_rejected,v_final_status;
    return jsonb_build_object(
      'processed',true,'failed',true,'batchId',v_chunk."batchId",
      'chunkIndex',v_chunk."chunkIndex",'error',v_error,
      'processedChunks',v_processed,'insertedRows',v_inserted_total,
      'duplicateRows',v_duplicate_total,'failedChunks',v_failed_total,
      'rejectedRows',v_rejected,'status',v_final_status
    );
  end;
end;
$$;

revoke all on function public.process_next_student_import_chunk() from public, anon, authenticated;
grant execute on function public.process_next_student_import_chunk() to service_role;


-- Tighten direct Data API writes: authenticated owners can stage chunks and
-- transition their own batch to QUEUED, but cannot forge processing counters.
alter table public."StudentImportBatch"
  add constraint "StudentImportBatch_total_rows_cap"
    check ("totalRows" <= 50000),
  add constraint "StudentImportBatch_total_chunks_cap"
    check ("totalChunks" <= 500),
  add constraint "StudentImportBatch_chunk_count_matches_rows"
    check ("totalChunks" = ceil(("totalRows"-"rejectedRows")::numeric/100)::integer),
  add constraint "StudentImportBatch_rejected_lte_total"
    check ("rejectedRows" <= "totalRows"),
  add constraint "StudentImportBatch_processed_lte_total_chunks"
    check ("processedChunks" <= "totalChunks"),
  add constraint "StudentImportBatch_failed_lte_processed"
    check ("failedChunks" <= "processedChunks"),
  add constraint "StudentImportBatch_result_rows_lte_valid"
    check ("insertedRows" + "duplicateRows" <= "totalRows" - "rejectedRows");

drop policy if exists verity_student_import_owner_insert on public."StudentImportBatch";
create policy verity_student_import_owner_insert on public."StudentImportBatch"
  for insert to authenticated with check (
    "createdBy"=(select auth.uid())::text
    and status='UPLOADING'
    and "insertedRows"=0 and "duplicateRows"=0
    and "processedChunks"=0 and "failedChunks"=0
    and "completedAt" is null
    and exists(select 1 from public."Organization" o
      where o.id="StudentImportBatch"."organizationId"
        and o."ownerId"=(select auth.uid())::text
        and o.type='INSTITUTION' and o.status='APPROVED')
  );

drop policy if exists verity_student_import_owner_update on public."StudentImportBatch";
create policy verity_student_import_owner_update on public."StudentImportBatch"
  for update to authenticated using (
    status='UPLOADING'
    and exists(select 1 from public."Organization" o
      where o.id="StudentImportBatch"."organizationId"
        and o."ownerId"=(select auth.uid())::text
        and o.type='INSTITUTION' and o.status='APPROVED')
  ) with check (
    status in ('QUEUED','PARTIAL')
    and (("status"='QUEUED' and "totalChunks">0)
      or ("status"='PARTIAL' and "totalChunks"=0))
    and exists(select 1 from public."Organization" o
      where o.id="StudentImportBatch"."organizationId"
        and o."ownerId"=(select auth.uid())::text
        and o.type='INSTITUTION' and o.status='APPROVED')
  );

drop policy if exists verity_student_import_chunk_owner_insert on public."StudentImportChunk";
create policy verity_student_import_chunk_owner_insert on public."StudentImportChunk"
  for insert to authenticated with check (
    "createdBy"=(select auth.uid())::text
    and status='PENDING' and attempts=0
    and "errorMessage" is null and "processedAt" is null
    and exists(
      select 1 from public."Organization" o
      join public."StudentImportBatch" b on b."organizationId"=o.id
      where o.id="StudentImportChunk"."organizationId"
        and b.id="StudentImportChunk"."batchId"
        and b."createdBy"=(select auth.uid())::text
        and b.status='UPLOADING'
        and "StudentImportChunk"."chunkIndex" < b."totalChunks"
        and jsonb_array_length("StudentImportChunk".rows)
          = least(100, b."totalRows"-b."rejectedRows"-("StudentImportChunk"."chunkIndex"*100))
        and o."ownerId"=(select auth.uid())::text
        and o.type='INSTITUTION' and o.status='APPROVED'
    )
  );

drop policy if exists verity_student_roster_owner_insert on public."StudentRoster";
drop policy if exists verity_student_roster_owner_update on public."StudentRoster";
revoke all on public."StudentRoster" from public,anon,authenticated;
grant select on public."StudentRoster" to authenticated;

revoke all on public."StudentImportBatch" from public,anon,authenticated;
grant select,insert on public."StudentImportBatch" to authenticated;
grant update(status,"updatedAt","completedAt") on public."StudentImportBatch" to authenticated;

revoke all on public."StudentImportChunk" from public,anon,authenticated;
grant select,insert on public."StudentImportChunk" to authenticated;
