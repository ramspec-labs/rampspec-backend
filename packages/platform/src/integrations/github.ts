import { createHmac, timingSafeEqual } from "node:crypto";

import { computeCheckRunKey, type CheckRun } from "./checks.js";

export function verifyGithubSignature(
  body: string,
  signature: string,
  secret: string,
): boolean {
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  return (
    signature.length === expected.length &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  );
}

export interface PublishCheckOptions {
  readonly backoffFactor?: number;
  readonly fetcher?: typeof fetch;
  readonly initialDelayMs?: number;
  readonly jitter?: boolean;
  readonly maxAttempts?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly token: string;
}

export interface PublishCheckResult {
  readonly attempts: number;
  readonly checkKey: string;
  readonly delivered: boolean;
  readonly error?: string;
  readonly status: number | null;
}

export async function publishGitHubCheck(
  repo: string,
  runId: string,
  check: CheckRun,
  options: PublishCheckOptions,
): Promise<PublishCheckResult> {
  const checkKey = computeCheckRunKey(runId, check.suiteId);
  const target = new URL(
    `https://api.github.com/repos/${repo}/check-runs`,
  );
  const maxAttempts = options.maxAttempts ?? 3;
  const initialDelay = options.initialDelayMs ?? 100;
  const factor = options.backoffFactor ?? 2;
  const fetcher = options.fetcher ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((res) => setTimeout(res, ms)));

  let lastStatus: number | null = null;
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetcher(target, {
        body: JSON.stringify({
          conclusion: check.conclusion,
          details_url: check.reportUrl,
          external_id: checkKey,
          name: `RampSpec / ${check.suiteId}`,
          output: {
            annotations_count: check.annotations,
            summary: `Run ${runId} concluded with ${check.conclusion}.`,
            title: `RampSpec Suite ${check.suiteId}`,
          },
          status: "completed",
        }),
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${options.token}`,
          "Content-Type": "application/json",
          "User-Agent": "rampspec-backend",
        },
        method: "POST",
      });

      lastStatus = response.status;

      if (response.ok) {
        return {
          attempts: attempt,
          checkKey,
          delivered: true,
          status: response.status,
        };
      }

      // Permanent errors (authorization / validation 4xx, except 429) should fail fast without retrying
      if (
        response.status === 401 ||
        response.status === 403 ||
        response.status === 404 ||
        response.status === 422
      ) {
        return {
          attempts: attempt,
          checkKey,
          delivered: false,
          error: `GitHub API error ${response.status}`,
          status: response.status,
        };
      }

      // Retryable status: 429 (rate-limit) or 5xx
      const isRetryable = response.status === 429 || response.status >= 500;
      if (!isRetryable || attempt >= maxAttempts) {
        return {
          attempts: attempt,
          checkKey,
          delivered: false,
          error: `Exhausted retries or non-retryable status ${response.status}`,
          status: response.status,
        };
      }

      const retryAfterHeader = response.headers.get("retry-after");
      let delayMs = initialDelay * Math.pow(factor, attempt - 1);
      if (retryAfterHeader) {
        const parsed = Number(retryAfterHeader);
        if (!isNaN(parsed) && parsed > 0) {
          delayMs = parsed * 1000;
        }
      }
      await sleep(delayMs);
    } catch (err) {
      lastStatus = null;
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt >= maxAttempts) {
        return {
          attempts: attempt,
          checkKey,
          delivered: false,
          error: lastError,
          status: null,
        };
      }
      const delayMs = initialDelay * Math.pow(factor, attempt - 1);
      await sleep(delayMs);
    }
  }

  return {
    attempts: maxAttempts,
    checkKey,
    delivered: false,
    error: lastError ?? "Max attempts reached",
    status: lastStatus,
  };
}
