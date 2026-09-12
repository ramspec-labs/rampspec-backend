import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limit.js";
describe("rate limiting", () => { it("enforces a bounded organization and actor window", () => { let now = 0; const limiter = new RateLimiter({ limit: 2, windowMs: 1000, clock: () => now }); expect(limiter.consume("org:user").allowed).toBe(true); expect(limiter.consume("org:user").remaining).toBe(0); expect(limiter.consume("org:user")).toMatchObject({ allowed: false, retryAfterSeconds: 1 }); now = 1001; expect(limiter.consume("org:user").allowed).toBe(true); }); });
