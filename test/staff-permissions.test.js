import test from "node:test";
import assert from "node:assert/strict";
import { STAFF_PERMISSIONS, isValidStaffPermissions, hasStaffPermission } from "../server/staff-permissions.js";

test("staff permission allowlist is intentionally narrow", () => {
  assert.deepEqual(STAFF_PERMISSIONS, ["certificates:read", "documents:download"]);
  assert.equal(isValidStaffPermissions(["certificates:read"]), true);
  assert.equal(isValidStaffPermissions(["certificates:read", "documents:download"]), true);
  assert.equal(isValidStaffPermissions(["documents:download"]), false);
  assert.equal(isValidStaffPermissions(["certificates:issue"]), false);
  assert.equal(isValidStaffPermissions(["certificates:read", "certificates:read"]), false);
});

test("suspended staff cannot use permissions", () => {
  const staff = { status: "SUSPENDED", permissions: ["certificates:read", "documents:download"] };
  assert.equal(hasStaffPermission(staff, "certificates:read"), false);
  assert.equal(hasStaffPermission(staff, "documents:download"), false);
});

test("active staff can only use assigned permissions", () => {
  const staff = { status: "ACTIVE", permissions: ["certificates:read"] };
  assert.equal(hasStaffPermission(staff, "certificates:read"), true);
  assert.equal(hasStaffPermission(staff, "documents:download"), false);
  assert.equal(hasStaffPermission(staff, "certificates:issue"), false);
});
