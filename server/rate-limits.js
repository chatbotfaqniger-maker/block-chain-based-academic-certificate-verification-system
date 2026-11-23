import rateLimit from "express-rate-limit";

export function createVerificationRateLimiter({ windowMs = 60_000, limit = 30 } = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: "Too many verification requests. Please wait before trying again."
    }
  });
}
