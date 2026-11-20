import { describe, expect, it, vi } from "vitest";
import {
  calculateBackoff,
  executeWithSerializationRetry,
  isRetryableSerializationError,
  RETRYABLE_SQL_STATES,
} from "./postgres.js";

describe("serialization conflict retry", () => {
  it("recognizes retryable PostgreSQL serialization and deadlock errors", () => {
    expect(isRetryableSerializationError({ code: "40001" })).toBe(true);
    expect(isRetryableSerializationError({ code: "40P01" })).toBe(true);
    expect(isRetryableSerializationError({ code: "23505" })).toBe(false); // unique_violation
    expect(isRetryableSerializationError({ code: "42P01" })).toBe(false); // undefined_table
    expect(isRetryableSerializationError(new Error("network error"))).toBe(false);
    expect(isRetryableSerializationError(null)).toBe(false);
    expect(RETRYABLE_SQL_STATES.has("40001")).toBe(true);
  });

  it("calculates bounded jittered backoff", () => {
    const randomMin = () => 0; // -1 * jitterRange
    const randomMax = () => 0.999999; // +1 * jitterRange
    const randomMid = () => 0.5; // 0 jitter

    const base = 50;
    const max = 1000;
    const jitter = 0.2;

    const delayMid = calculateBackoff(0, base, max, jitter, randomMid);
    expect(delayMid).toBe(50);

    const delayAttempt1 = calculateBackoff(1, base, max, jitter, randomMid);
    expect(delayAttempt1).toBe(100);

    const delayMin = calculateBackoff(0, base, max, jitter, randomMin);
    expect(delayMin).toBe(40); // 50 - 10

    const delayMax = calculateBackoff(0, base, max, jitter, randomMax);
    expect(delayMax).toBe(60); // 50 + 10

    // Bounded by maxDelayMs
    const capped = calculateBackoff(10, base, max, jitter, randomMid);
    expect(capped).toBe(1000);
  });

  it("recovers transient serialization errors within budget", async () => {
    let callCount = 0;
    const sleep = vi.fn().mockResolvedValue(undefined);
    const trace = vi.fn();

    const result = await executeWithSerializationRetry(
      (attempt) => {
        callCount++;
        if (attempt < 2) {
          const err = new Error("could not serialize access due to read/write dependencies");
          (err as unknown as { code: string }).code = "40001";
          return Promise.reject(err);
        }
        return Promise.resolve({ count: callCount, success: true });
      },
      {
        baseDelayMs: 10,
        maxRetries: 3,
        onRetry: trace,
        sleep,
      },
    );

    expect(result).toEqual({ count: 3, success: true });
    expect(callCount).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(trace).toHaveBeenCalledTimes(2);
    expect(trace).toHaveBeenNthCalledWith(1, 1, "40001", expect.any(Number));
    expect(trace).toHaveBeenNthCalledWith(2, 2, "40001", expect.any(Number));
  });

  it("fails immediately on non-retryable database errors without retrying", async () => {
    let callCount = 0;
    const sleep = vi.fn();

    await expect(
      executeWithSerializationRetry(
        () => {
          callCount++;
          const err = new Error("table does not exist");
          (err as unknown as { code: string }).code = "42P01";
          return Promise.reject(err);
        },
        { maxRetries: 3, sleep },
      ),
    ).rejects.toThrow("table does not exist");

    expect(callCount).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("exhausts retries and rethrows error without partial state corruption", async () => {
    let callCount = 0;
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      executeWithSerializationRetry(
        () => {
          callCount++;
          const err = new Error("serialization conflict");
          (err as unknown as { code: string }).code = "40001";
          return Promise.reject(err);
        },
        { baseDelayMs: 5, maxRetries: 2, sleep },
      ),
    ).rejects.toThrow("serialization conflict");

    expect(callCount).toBe(3); // attempt 0, 1, 2
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});
