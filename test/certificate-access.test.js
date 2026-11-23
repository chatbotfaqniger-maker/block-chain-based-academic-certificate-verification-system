import test from "node:test";
import assert from "node:assert/strict";
import { getCertificateAccessDisplayStatus, isCertificateAccessActive } from "../server/certificate-access.js";

const now = new Date("2026-11-23T12:00:00.000Z");

test("an approved grant remains active before its expiry", () => {
  assert.equal(isCertificateAccessActive({ status: "APPROVED", expiresAt: "2026-11-24T12:00:00.000Z" }, now), true);
});

test("an approved grant is inactive at or after expiry", () => {
  assert.equal(isCertificateAccessActive({ status: "APPROVED", expiresAt: "2026-11-23T12:00:00.000Z" }, now), false);
  assert.equal(getCertificateAccessDisplayStatus({ status: "APPROVED", expiresAt: "2026-11-22T12:00:00.000Z" }, now), "EXPIRED");
});

test("pending, rejected and revoked grants never authorize document access", () => {
  for (const status of ["PENDING", "REJECTED", "REVOKED"]) {
    assert.equal(isCertificateAccessActive({ status, expiresAt: "2026-11-24T12:00:00.000Z" }, now), false);
    assert.equal(getCertificateAccessDisplayStatus({ status, expiresAt: "2026-11-24T12:00:00.000Z" }, now), status);
  }
});

test("missing or malformed expiry fails closed", () => {
  assert.equal(isCertificateAccessActive({ status: "APPROVED" }, now), false);
  assert.equal(isCertificateAccessActive({ status: "APPROVED", expiresAt: "not-a-date" }, now), false);
});
