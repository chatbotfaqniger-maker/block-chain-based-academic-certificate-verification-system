export function isCertificateAccessActive(grant, now = new Date()) {
  if (!grant || grant.status !== "APPROVED" || !grant.expiresAt) return false;
  const expiry = new Date(grant.expiresAt);
  return Number.isFinite(expiry.getTime()) && expiry > now;
}

export function getCertificateAccessDisplayStatus(grant, now = new Date()) {
  if (!grant?.status) return "UNKNOWN";
  if (grant.status === "APPROVED" && !isCertificateAccessActive(grant, now)) return "EXPIRED";
  return grant.status;
}
