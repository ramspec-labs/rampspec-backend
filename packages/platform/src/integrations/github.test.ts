import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { createCheckRun } from "./checks.js";
import { publishGitHubCheck, verifyGithubSignature } from "./github.js";

describe("GitHub integrations", () => {
  it("verifies signed GitHub payloads", () => {
    const body = "{}";
    const sig = `sha256=${createHmac("sha256", "s").update(body).digest("hex")}`;
    expect(verifyGithubSignature(body, sig, "s")).toBe(true);
    expect(verifyGithubSignature(body, sig, "wrong")).toBe(false);
  });

  it("publishes checks successfully with idempotent key", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 201 }));
    const check = createCheckRun("suite-123", true, "https://example.com/reports/1", 0);

    const result = await publishGitHubCheck("rampspec-labs/rampspec-backend", "run-456", check, {
      fetcher,
      token: "ghs_test_token",
    });

    expect(result.delivered).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.checkKey).toBe("rampspec:run:run-456:suite:suite-123");
    expect(fetcher).toHaveBeenCalledTimes(1);

    const callInit = fetcher.mock.calls[0]?.[1] as RequestInit | undefined;
    const bodyStr = typeof callInit?.body === "string" ? callInit.body : "{}";
    const callBody = JSON.parse(bodyStr) as { conclusion: string; external_id: string };
    expect(callBody.external_id).toBe("rampspec:run:run-456:suite:suite-123");
    expect(callBody.conclusion).toBe("success");
  });

  it("retries on transient 5xx errors with bounded exponential backoff", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("Internal Server Error", { status: 500 }))
      .mockResolvedValueOnce(new Response("Service Unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const check = createCheckRun("suite-123", false, "https://example.com/reports/2", 1);
    const result = await publishGitHubCheck("rampspec-labs/rampspec-backend", "run-789", check, {
      backoffFactor: 2,
      fetcher,
      initialDelayMs: 50,
      maxAttempts: 3,
      sleep,
      token: "ghs_test_token",
    });

    expect(result.delivered).toBe(true);
    expect(result.attempts).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 50);
    expect(sleep).toHaveBeenNthCalledWith(2, 100);
  });

  it("respects Retry-After header on 429 responses", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("Too Many Requests", {
          headers: { "retry-after": "3" },
          status: 429,
        }),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 201 }));

    const check = createCheckRun("suite-123", true, "https://example.com/reports/3", 0);
    const result = await publishGitHubCheck("rampspec-labs/rampspec-backend", "run-999", check, {
      fetcher,
      maxAttempts: 2,
      sleep,
      token: "ghs_test_token",
    });

    expect(result.delivered).toBe(true);
    expect(result.attempts).toBe(2);
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it("does not retry permanent 401/403/404/422 errors", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetcher = vi.fn().mockResolvedValue(new Response("Unauthorized", { status: 401 }));

    const check = createCheckRun("suite-123", true, "https://example.com/reports/4", 0);
    const result = await publishGitHubCheck("rampspec-labs/rampspec-backend", "run-111", check, {
      fetcher,
      maxAttempts: 3,
      sleep,
      token: "ghs_test_token",
    });

    expect(result.delivered).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.status).toBe(401);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("handles exhausted retries gracefully", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetcher = vi.fn().mockResolvedValue(new Response("Gateway Timeout", { status: 504 }));

    const check = createCheckRun("suite-123", true, "https://example.com/reports/5", 0);
    const result = await publishGitHubCheck("rampspec-labs/rampspec-backend", "run-222", check, {
      fetcher,
      maxAttempts: 2,
      sleep,
      token: "ghs_test_token",
    });

    expect(result.delivered).toBe(false);
    expect(result.attempts).toBe(2);
    expect(result.status).toBe(504);
  });
});
