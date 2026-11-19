import { normalizeContentType } from "../execution/content-type.js";

/** Maximum response-body bytes a target probe drains before aborting. */
export const PROBE_MAX_RESPONSE_BYTES = 65_536;
/** Maximum bytes of any single retained probe header value. */
export const PROBE_MAX_HEADER_VALUE_BYTES = 4_096;
/** Maximum combined bytes of the retained probe header values. */
export const PROBE_MAX_KEPT_HEADER_BYTES = 8_192;
/** Maximum combined bytes of every response header name and value. */
export const PROBE_MAX_TOTAL_HEADER_BYTES = 65_536;
/** Maximum number of SEP identifiers retained from one probe. */
export const PROBE_MAX_SUPPORTED_SEPS = 32;

/**
 * Discovery representations a capability probe accepts as a valid discovery
 * response. Stellar discovery documents are plain text (`stellar.toml`) or
 * JSON; anything else (for example an HTML error page) is recorded as
 * unsupported content, never mistaken for a discovery document.
 */
export const ACCEPTED_DISCOVERY_CONTENT_TYPES = [
  "application/json",
  "text/plain",
] as const;

export type AcceptedDiscoveryContentType =
  (typeof ACCEPTED_DISCOVERY_CONTENT_TYPES)[number];

export type ProbeContentTypeStatus =
  | "accepted"
  | "malformed"
  | "missing"
  | "unsupported";

const MAX_SEP_VERSION_HEADER_LENGTH = 1024;
const MAX_SEP_LENGTH = 64;
const SEP_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

/** Header names a probe retains; every other header is dropped unread. */
const RETAINED_HEADERS = ["content-type", "x-stellar-toml-version"] as const;

export type ProbeLimitReason =
  | "content-length-budget-exceeded"
  | "header-budget-exceeded"
  | "response-budget-exceeded";

export interface CapabilityProbe {
  readonly checkedAt: string;
  readonly reachable: boolean;
  readonly status: number | null;
  readonly supportedSeps: readonly string[];
  readonly headers: Readonly<Record<string, string>>;
  /** True when the probe aborted because a response budget was exceeded. */
  readonly budgetExceeded: boolean;
  /** Which budget was exceeded, or null when the probe stayed in budget. */
  readonly limitReason: ProbeLimitReason | null;
  /** Normalized discovery media type, or null when absent or unusable. */
  readonly contentType: string | null;
  readonly contentTypeSupported: boolean;
  readonly contentTypeStatus: ProbeContentTypeStatus;
  /**
   * True only for a reachable target that answered with an accepted discovery
   * content type. A missing, malformed, or unsupported content type is never
   * treated as valid discovery (safe fallback); reachability is unaffected.
   */
  readonly discoveryValid: boolean;
}

export interface ProbeTargetOptions {
  readonly fetcher?: typeof fetch;
  readonly clock?: () => Date;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly maxHeaderValueBytes?: number;
  readonly maxKeptHeaderBytes?: number;
  readonly maxTotalHeaderBytes?: number;
  readonly maxSupportedSeps?: number;
}

/** UTF-8 byte length without allocating a copy of the value. */
function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < value.length
    ) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function positiveBudget(value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new Error("Probe budgets must be positive.");
  }
  return Math.floor(resolved);
}

function parseSupportedSeps(
  raw: string | undefined,
  maxSupportedSeps: number,
): string[] {
  if (raw === undefined) return [];
  if (raw.length > MAX_SEP_VERSION_HEADER_LENGTH) return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && value.length <= MAX_SEP_LENGTH)
    .filter((value) => SEP_PATTERN.test(value))
    .slice(0, maxSupportedSeps);
}

function unreachableProbe(
  clock: () => Date,
  status: number | null,
  budgetExceeded: boolean,
  limitReason: ProbeLimitReason | null,
): CapabilityProbe {
  return Object.freeze({
    budgetExceeded,
    checkedAt: clock().toISOString(),
    contentType: null,
    contentTypeStatus: "missing",
    contentTypeSupported: false,
    discoveryValid: false,
    headers: {},
    limitReason,
    reachable: false,
    status,
    supportedSeps: [],
  });
}

export async function probeTarget(
  origin: string,
  options: ProbeTargetOptions = {},
): Promise<CapabilityProbe> {
  const url = new URL(origin);
  if (url.protocol !== "https:") {
    throw new Error("Target probe requires HTTPS.");
  }
  // Never send credentials embedded in a target URL to the target.
  url.username = "";
  url.password = "";
  const clock = options.clock ?? (() => new Date());
  const maxResponseBytes = positiveBudget(
    options.maxResponseBytes,
    PROBE_MAX_RESPONSE_BYTES,
  );
  const maxHeaderValueBytes = positiveBudget(
    options.maxHeaderValueBytes,
    PROBE_MAX_HEADER_VALUE_BYTES,
  );
  const maxKeptHeaderBytes = positiveBudget(
    options.maxKeptHeaderBytes,
    PROBE_MAX_KEPT_HEADER_BYTES,
  );
  const maxTotalHeaderBytes = positiveBudget(
    options.maxTotalHeaderBytes,
    PROBE_MAX_TOTAL_HEADER_BYTES,
  );
  const maxSupportedSeps = positiveBudget(
    options.maxSupportedSeps,
    PROBE_MAX_SUPPORTED_SEPS,
  );
  const fetcher = options.fetcher ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 5000,
  );
  try {
    const response = await fetcher(url, {
      method: "HEAD",
      redirect: "error",
      signal: controller.signal,
    });

    // Fail closed when the response is aborted: discard any partial content.
    const overBudget = async (
      reason: ProbeLimitReason,
    ): Promise<CapabilityProbe> => {
      controller.abort();
      try {
        await response.body?.cancel();
      } catch {
        // Cancellation is best effort; the probe result is already bounded.
      }
      return unreachableProbe(clock, response.status, true, reason);
    };

    // Header entries work for both a Headers object and an array of tuples.
    const headerEntries: Array<readonly [string, string]> = [
      ...response.headers,
    ];

    // A declared body larger than the budget is refused without reading it.
    const declaredLength = Number(
      headerEntries.find(
        ([key]) => key.toLowerCase() === "content-length",
      )?.[1] ?? "",
    );
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > maxResponseBytes
    ) {
      return overBudget("content-length-budget-exceeded");
    }

    // Retain only the protocol headers, each bounded, and bound the raw
    // header total so a flood of dropped headers cannot grow memory either.
    let rawContentType: string | undefined;
    let rawSepHeader: string | undefined;
    let keptHeaderBytes = 0;
    let totalHeaderBytes = 0;
    for (const [key, value] of headerEntries) {
      totalHeaderBytes += utf8ByteLength(key) + utf8ByteLength(value);
      if (totalHeaderBytes > maxTotalHeaderBytes) {
        return overBudget("header-budget-exceeded");
      }
      const name = key.toLowerCase();
      if ((RETAINED_HEADERS as readonly string[]).includes(name)) {
        const valueBytes = utf8ByteLength(value);
        if (valueBytes > maxHeaderValueBytes) {
          return overBudget("header-budget-exceeded");
        }
        keptHeaderBytes += valueBytes;
        if (keptHeaderBytes > maxKeptHeaderBytes) {
          return overBudget("header-budget-exceeded");
        }
        if (name === "content-type") rawContentType = value;
        else rawSepHeader = value;
      }
    }

    // HEAD responses carry no body, but a non-compliant target may send one.
    // Drain it in bounded chunks, counting bytes only: chunk contents are
    // discarded immediately and never stored, logged, or hashed.
    if (response.body) {
      const reader = response.body.getReader();
      let bodyBytes = 0;
      try {
        for (;;) {
          const chunk: { done: boolean; value?: Uint8Array } =
            await reader.read();
          if (chunk.done) {
            break;
          }
          bodyBytes += chunk.value?.byteLength ?? 0;
          if (bodyBytes > maxResponseBytes) {
            try {
              await reader.cancel();
            } catch {
              // Cancellation is best effort; the probe result is bounded.
            }
            return overBudget("response-budget-exceeded");
          }
        }
      } catch {
        // A body read failure (reset, timeout) fails closed with no content.
        return unreachableProbe(clock, response.status, false, null);
      }
    }

    const contentType = normalizeContentType(rawContentType);
    const contentTypeStatus: ProbeContentTypeStatus =
      rawContentType === undefined
        ? "missing"
        : contentType === null
          ? "malformed"
          : (
                ACCEPTED_DISCOVERY_CONTENT_TYPES as readonly string[]
              ).includes(contentType)
            ? "accepted"
            : "unsupported";
    const contentTypeSupported = contentTypeStatus === "accepted";
    const supportedSeps = parseSupportedSeps(rawSepHeader, maxSupportedSeps);
    // Record only the normalized content type and the sanitized SEP list;
    // arbitrary or hostile header values are never persisted.
    const headers: Record<string, string> = {};
    if (contentType !== null) headers["content-type"] = contentType;
    if (supportedSeps.length > 0) {
      headers["x-stellar-toml-version"] = supportedSeps.join(", ");
    }
    return Object.freeze({
      budgetExceeded: false,
      checkedAt: clock().toISOString(),
      contentType,
      contentTypeStatus,
      contentTypeSupported,
      discoveryValid: response.ok && contentTypeSupported,
      headers,
      limitReason: null,
      reachable: response.ok,
      status: response.status,
      supportedSeps,
    });
  } catch {
    return unreachableProbe(clock, null, false, null);
  } finally {
    clearTimeout(timeout);
  }
}
