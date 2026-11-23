import test from "node:test";
import assert from "node:assert/strict";
import { startStudentImportWorker } from "../server/student-import-worker.js";

test("student import worker drains queued chunks and stops gracefully", async () => {
  let calls = 0;
  const client = {
    async rpc(name) {
      assert.equal(name, "process_next_student_import_chunk");
      calls += 1;
      if (calls === 1) return { data: { processed: true, batchId: "batch-1", chunkIndex: 0, inserted: 100, duplicates: 0, status: "PROCESSING" } };
      return { data: { processed: false } };
    }
  };
  const quiet = { info() {}, error() {} };
  const stop = startStudentImportWorker({ client, logger: quiet, pollIntervalMs: 5 });
  for (let i = 0; i < 20 && calls < 2; i += 1) await new Promise(resolve => setTimeout(resolve, 2));
  await stop();
  assert.ok(calls >= 2, "worker should process a chunk then poll for more work");
});

test("student import worker backs off after queue errors and can still stop", async () => {
  let calls = 0;
  const client = { async rpc() { calls += 1; throw new Error("temporary database outage"); } };
  const quiet = { info() {}, error() {} };
  const stop = startStudentImportWorker({ client, logger: quiet, pollIntervalMs: 5, maxBackoffMs: 20 });
  await new Promise(resolve => setTimeout(resolve, 8));
  await stop();
  assert.ok(calls >= 1);
});
