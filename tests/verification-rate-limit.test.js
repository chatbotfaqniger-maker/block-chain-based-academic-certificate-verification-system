import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createVerificationRateLimiter } from "../server/rate-limits.js";

test("public verification endpoint limiter blocks requests after its per-IP allowance", async () => {
  const app = express();
  app.use(express.json());
  app.post("/verify", createVerificationRateLimiter({ windowMs: 60_000, limit: 2 }), (_req, res) => {
    res.status(200).json({ verified: true });
  });

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  try {
    const address = server.address();
    const endpoint = `http://127.0.0.1:${address.port}/verify`;
    const first = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const second = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const third = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(third.status, 429);
    assert.match(third.headers.get("ratelimit") || third.headers.get("ratelimit-limit") || "", /2|limit/i);
    const body = await third.json();
    assert.match(body.error, /too many verification requests/i);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
