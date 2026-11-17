export const STAFF_PERMISSIONS = Object.freeze([
  "certificates:read",
  "documents:download"
]);

export function isValidStaffPermissions(permissions) {
  if (!Array.isArray(permissions) || permissions.length < 1 || permissions.length > STAFF_PERMISSIONS.length) {
    return false;
  }
  if (new Set(permissions).size !== permissions.length) return false;
  if (permissions.some(permission => !STAFF_PERMISSIONS.includes(permission))) return false;
  return !permissions.includes("documents:download") || permissions.includes("certificates:read");
}

export function hasStaffPermission(staff, permission) {
  return STAFF_PERMISSIONS.includes(permission)
    && Boolean(staff)
    && staff.status === "ACTIVE"
    && isValidStaffPermissions(staff.permissions)
    && staff.permissions.includes(permission);
}
