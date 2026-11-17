import test from "node:test";
import assert from "node:assert/strict";
import { STAFF_PERMISSIONS, isValidStaffPermissions, hasStaffPermission } from "../server/staff-permissions.js";

test("staff permissions are limited to certificate reading and document downloads", () => {
  assert.deepEqual(STAFF_PERMISSIONS, ["certificates:read", "documents:download"]);
  assert.equal(isValidStaffPermissions(["certificates:read"]), true);
  assert.equal(isValidStaffPermissions(["certificates:read", "documents:download"]), true);
  assert.equal(isValidStaffPermissions(["credentials:verify"]), false);
  assert.equal(isValidStaffPermissions(["certificates:read", "credentials:verify"]), false);
});

test("document downloads cannot be assigned without certificate read access", () => {
  assert.equal(isValidStaffPermissions(["documents:download"]), false);
});

test("duplicate or empty permission assignments fail closed", () => {
  assert.equal(isValidStaffPermissions([]), false);
  assert.equal(isValidStaffPermissions(["certificates:read", "certificates:read"]), false);
});

test("active staff can read only when certificate-read permission is assigned", () => {
  assert.equal(hasStaffPermission({ status: "ACTIVE", permissions: ["certificates:read"] }, "certificates:read"), true);
  assert.equal(hasStaffPermission({ status: "ACTIVE", permissions: ["certificates:read"] }, "documents:download"), false);
});

test("document download permission requires both supported permissions", () => {
  assert.equal(hasStaffPermission({ status: "ACTIVE", permissions: ["certificates:read", "documents:download"] }, "documents:download"), true);
});

test("suspended staff immediately lose every staff permission", () => {
  const staff = { status: "SUSPENDED", permissions: ["certificates:read", "documents:download"] };
  assert.equal(hasStaffPermission(staff, "certificates:read"), false);
  assert.equal(hasStaffPermission(staff, "documents:download"), false);
});

test("unknown permission checks are denied", () => {
  assert.equal(hasStaffPermission({ status: "ACTIVE", permissions: ["certificates:read"] }, "credentials:verify"), false);
});
