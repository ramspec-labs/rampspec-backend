import type { IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

import {
  resolveTargetAddresses,
  validateResolvedAddresses,
  type TargetAddressResolver,
} from "./outbound-address-policy.js";

/**
 * A fetch implementation that connects to one pre-validated IP address.
 *
 * The socket opens against the pinned address, never against a fresh DNS
 * lookup, so a record change between resolution and connect cannot steer
 * the request elsewhere. TLS still verifies the original hostname: SNI and
 * the certificate hostname check use the hostname, not the pinned IP.
 * Redirects are never followed; a 3xx response is returned as-is and the
 * probe treats it as unreachable.
 */

export interface PinnedFetcherOptions {
  readonly resolver?: TargetAddressResolver;
  readonly timeoutMs?: number;
}

function responseHeaders(headers: IncomingHttpHeaders): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) result.append(name, entry);
    } else {
      result.set(name, value);
    }
  }
  return result;
}

export function createPinnedFetcher(
  pinnedAddress: string,
  options: PinnedFetcherOptions = {},
): typeof fetch {
  return async (input, init) => {
    const requestUrl = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (requestUrl.protocol !== "https:") {
      throw new Error("Pinned fetch requires HTTPS.");
    }

    // Re-resolve immediately before connecting. If DNS changed since the
    // probe resolved the target, or any fresh answer is non-public, the
    // pinned address is no longer trustworthy: fail closed without
    // opening a socket.
    const fresh = await resolveTargetAddresses(
      requestUrl.hostname,
      options.resolver,
      options.timeoutMs,
    );
    const validated = validateResolvedAddresses(fresh);
    if (!validated.addresses.includes(pinnedAddress)) {
      throw new Error(
        "Target hostname addresses changed between resolution and connection.",
      );
    }

    const hostname = requestUrl.hostname;
    return new Promise<Response>((resolvePromise, reject) => {
      const request = httpsRequest(
        {
          host: pinnedAddress,
          method: init?.method ?? "GET",
          path: `${requestUrl.pathname}${requestUrl.search}`,
          port: Number(requestUrl.port || 443),
          rejectUnauthorized: true,
          signal: init?.signal ?? undefined,
          ...(isIP(hostname) === 0 ? { servername: hostname } : {}),
        },
        (response) => {
          resolvePromise(
            new Response(null, {
              headers: responseHeaders(response.headers),
              status: response.statusCode ?? 500,
            }),
          );
        },
      );
      request.on("error", reject);
      request.end();
    });
  };
}
