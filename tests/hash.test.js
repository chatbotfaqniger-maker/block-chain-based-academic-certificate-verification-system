import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

test("SHA-256 fingerprints are deterministic", () => {
  const canonical = JSON.stringify({ certificateId: "VRT-2026-AB12", studentNumber: "2020/CSC/01" });
  const first = createHash("sha256").update(canonical).digest("hex");
  const second = createHash("sha256").update(canonical).digest("hex");
  assert.equal(first, second);
  assert.equal(first.length, 64);
});

test("a changed certificate payload produces a different fingerprint", () => {
  const a = createHash("sha256").update("grade: First Class").digest("hex");
  const b = createHash("sha256").update("grade: Second Class").digest("hex");
  assert.notEqual(a, b);
});
