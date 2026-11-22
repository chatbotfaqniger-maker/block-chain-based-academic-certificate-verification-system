import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = new URL("../supabase/migrations/20261122140000_durable_bulk_certificate_issuance_queue.sql", import.meta.url);

test("bulk issuance queue migration keeps tenant-scoped idempotency and duplicate guards", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /unique\s*\(\s*"organizationId"\s*,\s*"idempotencyKey"\s*\)/i);
  assert.match(sql, /unique\s*\(\s*"batchId"\s*,\s*"studentNumber"\s*\)/i);
  assert.match(sql, /unique\s*\(\s*"batchId"\s*,\s*"rowNumber"\s*\)/i);
});

test("queue RPCs use invoker security and restrict execution to service role", async () => {
  const sql = await readFile(migration, "utf8");
  assert.equal((sql.match(/security\s+invoker/gi) || []).length, 3);
  assert.doesNotMatch(sql, /security\s+definer/i);
  assert.match(sql, /revoke all on function public\.claim_next_certificate_issuance_item\(text\) from public,anon,authenticated/i);
  assert.match(sql, /grant execute on function public\.claim_next_certificate_issuance_item\(text\) to service_role/i);
  assert.match(sql, /revoke all on function public\.finish_certificate_issuance_item\(text,text,text,text,text,text\) from public,anon,authenticated/i);
  assert.match(sql, /grant execute on function public\.finish_certificate_issuance_item\(text,text,text,text,text,text\) to service_role/i);
});

test("worker leases require reconciliation after expiry instead of blind reissue", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /for update of i skip locked/i);
  assert.match(sql, /lease expired\. check the certificate registry and audit log before any retry\./i);
  assert.match(sql, /LEASE_EXPIRED_REQUIRES_RECONCILIATION/);
  assert.match(sql, /status='NEEDS_REVIEW'/);
});

test("staged issuance payload and tenant identity are immutable", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /guard_certificate_issuance_item_tenant/);
  assert.match(sql, /issuance item organization must match its batch/i);
  assert.match(sql, /staged issuance identity and payload are immutable/i);
  assert.match(sql, /alter table public\."CertificateIssuanceBatch" enable row level security/i);
  assert.match(sql, /alter table public\."CertificateIssuanceItem" enable row level security/i);
});
