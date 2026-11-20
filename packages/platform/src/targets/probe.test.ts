import { describe, expect, it, vi } from "vitest";

import type { TargetAddressResolver } from "./outbound-address-policy.js";
import { probeTarget } from "./probe.js";

const clock = () => new Date("2026-09-12T18:00:00.000Z");
const publicAddress = { address: "93.184.216.34", family: 4 };

function resolverFor(
  addresses: readonly { address: string; family: number }[],
): TargetAddressResolver {
  return () => Promise.resolve(addresses);
}

function okFetcher() {
  return vi.fn().mockResolvedValue(
    new Response(null, {
      headers: { "x-stellar-toml-version": "SEP-0001, SEP-0012", server: "hidden" },
      status: 200,
    }),
  );
}

describe("target capability probe", () => {
  it("captures bounded protocol headers", async () => {
    const fetcher = okFetcher();
    const result = await probeTarget("https://example.com", {
      clock,
      fetcher,
      resolver: resolverFor([publicAddress]),
    });
    expect(result.reachable).toBe(true);
    expect(result.supportedSeps).toEqual(["SEP-0001", "SEP-0012"]);
    expect(result.headers).not.toHaveProperty("server");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("fails closed for unsafe and unreachable targets", async () => {
    await expect(probeTarget("http://example.com")).rejects.toThrow("HTTPS");
    const result = await probeTarget("https://example.com", {
      fetcher: vi.fn().mockRejectedValue(new Error("timeout")),
      resolver: resolverFor([publicAddress]),
    });
    expect(result.reachable).toBe(false);
    expect(result.status).toBeNull();
  });

  it.each([
    ["https://127.0.0.1", "IPv4 loopback"],
    ["https://127.53.1.2", "IPv4 loopback range"],
    ["https://10.0.0.5", "private"],
    ["https://172.16.0.9", "private"],
    ["https://192.168.1.1", "private"],
    ["https://169.254.169.254", "cloud metadata"],
    ["https://169.254.10.20", "link-local"],
    ["https://100.64.0.1", "shared address space"],
    ["https://0.0.0.0", "unspecified"],
    ["https://[::1]", "IPv6 loopback"],
    ["https://[fe80::1]", "IPv6 link-local"],
    ["https://[fc00::1]", "IPv6 unique-local"],
    ["https://[fd00:ec2::254]", "IPv6 cloud metadata"],
    ["https://[::ffff:127.0.0.1]", "IPv4-mapped loopback"],
  ])("rejects %s (%s) without connecting", async (origin) => {
    const fetcher = okFetcher();
    const result = await probeTarget(origin, { clock, fetcher });
    expect(result.reachable).toBe(false);
    expect(result.status).toBeNull();
    expect(result.supportedSeps).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [[publicAddress, { address: "169.254.169.254", family: 4 }], "mixed public and metadata"],
    [[publicAddress, { address: "10.0.0.5", family: 4 }], "mixed public and private"],
    [[publicAddress, { address: "::1", family: 6 }], "mixed public and loopback"],
    [[{ address: "169.254.169.254", family: 4 }], "metadata only"],
  ])("rejects a hostname resolving to %s without connecting", async (addresses) => {
    const fetcher = okFetcher();
    const result = await probeTarget("https://example.com", {
      clock,
      fetcher,
      resolver: resolverFor(addresses),
    });
    expect(result.reachable).toBe(false);
    expect(result.status).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fails closed when the hostname does not resolve", async () => {
    const fetcher = okFetcher();
    const result = await probeTarget("https://example.com", {
      clock,
      fetcher,
      resolver: resolverFor([]),
    });
    expect(result.reachable).toBe(false);
    expect(result.status).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fails closed when resolution itself fails", async () => {
    const fetcher = okFetcher();
    const resolver: TargetAddressResolver = () =>
      Promise.reject(new Error("ENOTFOUND"));
    const result = await probeTarget("https://example.com", {
      clock,
      fetcher,
      resolver,
    });
    expect(result.reachable).toBe(false);
    expect(result.status).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("never follows a redirect to a private address", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(null, {
        headers: { location: "https://169.254.169.254/latest/meta-data/" },
        status: 302,
      }),
    );
    const result = await probeTarget("https://example.com", {
      clock,
      fetcher,
      resolver: resolverFor([publicAddress]),
    });
    expect(result.reachable).toBe(false);
    expect(result.status).toBe(302);
    // No second request was issued to the redirect target.
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("fails closed when DNS changes between resolution and connect", async () => {
    let callsMade = 0;
    const changingResolver: TargetAddressResolver = () => {
      callsMade += 1;
      return Promise.resolve([
        {
          address: callsMade === 1 ? "93.184.216.34" : "93.184.216.35",
          family: 4,
        },
      ]);
    };
    // No stub fetcher: the default pinned transport re-resolves before
    // connecting and must refuse once the answers disagree, so no socket
    // is ever opened and no live network is needed.
    const result = await probeTarget("https://example.com", {
      clock,
      resolver: changingResolver,
    });
    expect(result.reachable).toBe(false);
    expect(result.status).toBeNull();
    expect(callsMade).toBe(2);
  });
});
