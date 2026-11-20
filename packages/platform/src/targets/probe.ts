import {
  DEFAULT_RESOLUTION_TIMEOUT_MS,
  resolveTargetAddresses,
  validateResolvedAddresses,
  type TargetAddressResolver,
} from "./outbound-address-policy.js";
import { createPinnedFetcher } from "./pinned-fetch.js";

export interface CapabilityProbe {
  readonly checkedAt: string;
  readonly reachable: boolean;
  readonly status: number | null;
  readonly supportedSeps: readonly string[];
  readonly headers: Readonly<Record<string, string>>;
}

export interface ProbeTargetOptions {
  readonly clock?: () => Date;
  /**
   * Transport override. The default transport connects to the single
   * validated IP address with TLS hostname verification against the
   * original hostname. A caller-supplied fetcher is a trusted test seam:
   * the target is still resolved and validated before it is invoked, but
   * the fetcher itself performs the connection.
   */
  readonly fetcher?: typeof fetch;
  /**
   * DNS resolver override. Defaults to the system resolver. Tests stub
   * this instead of touching the network.
   */
  readonly resolver?: TargetAddressResolver;
  readonly timeoutMs?: number;
}

export async function probeTarget(
  origin: string,
  options: ProbeTargetOptions = {},
): Promise<CapabilityProbe> {
  const url = new URL(origin);
  if (url.protocol !== "https:") {
    throw new Error("Target probe requires HTTPS.");
  }
  const timeoutMs = options.timeoutMs ?? 5000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Resolve and validate every address before connecting. A hostname
    // that resolves to any loopback, private, link-local, or metadata
    // address is rejected outright; the probe fails closed instead of
    // falling back to a public answer.
    const resolved = await resolveTargetAddresses(
      url.hostname,
      options.resolver,
      Math.min(timeoutMs, DEFAULT_RESOLUTION_TIMEOUT_MS),
    );
    const { pinned } = validateResolvedAddresses(resolved);
    const fetcher =
      options.fetcher ??
      createPinnedFetcher(pinned, {
        ...(options.resolver ? { resolver: options.resolver } : {}),
        timeoutMs,
      });
    const response = await fetcher(url, {
      method: "HEAD",
      redirect: "error",
      signal: controller.signal,
    });
    const headers: Record<string, string> = {};
    for (const [key, value] of response.headers) {
      if (["content-type", "x-stellar-toml-version"].includes(key.toLowerCase())) {
        headers[key.toLowerCase()] = value;
      }
    }
    return {
      checkedAt: (options.clock ?? (() => new Date()))().toISOString(),
      headers,
      reachable: response.ok,
      status: response.status,
      supportedSeps: (headers["x-stellar-toml-version"] ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    };
  } catch {
    return {
      checkedAt: (options.clock ?? (() => new Date()))().toISOString(),
      headers: {},
      reachable: false,
      status: null,
      supportedSeps: [],
    };
  } finally {
    clearTimeout(timeout);
  }
}
