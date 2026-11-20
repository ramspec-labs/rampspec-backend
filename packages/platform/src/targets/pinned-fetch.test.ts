import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createPinnedFetcher } from "./pinned-fetch.js";
import type { TargetAddressResolver } from "./outbound-address-policy.js";

vi.mock("node:https", () => ({
  request: vi.fn(),
}));

import { request as httpsRequest } from "node:https";

const mockedRequest = vi.mocked(httpsRequest);

const publicResolver: TargetAddressResolver = () =>
  Promise.resolve([{ address: "93.184.216.34", family: 4 }]);

function fakeRequest(): ClientRequest {
  return {
    end: vi.fn(),
    on: vi.fn().mockReturnThis(),
  } as unknown as ClientRequest;
}

function installHttpsStub(statusCode = 200): {
  readonly calls: RequestOptions[];
} {
  const calls: RequestOptions[] = [];
  mockedRequest.mockImplementation((options, callback) => {
    calls.push(options as RequestOptions);
    const message = {
      headers: { "content-type": "text/html" },
      statusCode,
    } as unknown as IncomingMessage;
    if (typeof callback === "function") {
      (callback as (message: IncomingMessage) => void)(message);
    }
    return fakeRequest();
  });
  return { calls };
}

afterEach(() => {
  mockedRequest.mockReset();
});

describe("pinned fetch", () => {
  it("connects to the pinned IP with TLS hostname checks on the hostname", async () => {
    const { calls } = installHttpsStub(200);
    const fetcher = createPinnedFetcher("93.184.216.34", {
      resolver: publicResolver,
    });
    const response = await fetcher("https://example.com/", {
      method: "HEAD",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      host: "93.184.216.34",
      method: "HEAD",
      path: "/",
      port: 443,
      servername: "example.com",
    });
  });

  it("honours an explicit port and path", async () => {
    const { calls } = installHttpsStub(200);
    const fetcher = createPinnedFetcher("93.184.216.34", {
      resolver: publicResolver,
    });
    await fetcher("https://example.com:8443/stellar.toml", { method: "HEAD" });
    expect(calls[0]).toMatchObject({
      host: "93.184.216.34",
      path: "/stellar.toml",
      port: 8443,
      servername: "example.com",
    });
  });

  it("does not set SNI for an IP-literal hostname", async () => {
    const { calls } = installHttpsStub(200);
    const fetcher = createPinnedFetcher("93.184.216.34", {
      resolver: publicResolver,
    });
    await fetcher("https://93.184.216.34/", { method: "HEAD" });
    expect(calls[0]).toMatchObject({ host: "93.184.216.34" });
    expect(calls[0]).not.toHaveProperty("servername");
  });

  it("fails closed when DNS changes between resolution and connect", async () => {
    const { calls } = installHttpsStub(200);
    // The probe already resolved 93.184.216.34 and pinned it; this is the
    // re-resolution immediately before connecting, and it disagrees.
    const changedResolver: TargetAddressResolver = () =>
      Promise.resolve([{ address: "93.184.216.35", family: 4 }]);
    const fetcher = createPinnedFetcher("93.184.216.34", {
      resolver: changedResolver,
    });
    await expect(fetcher("https://example.com/")).rejects.toThrow(
      "changed between resolution and connection",
    );
    expect(calls).toHaveLength(0);
  });

  it("fails closed when the fresh answers turn non-public", async () => {
    const { calls } = installHttpsStub(200);
    const rebindingResolver: TargetAddressResolver = () =>
      Promise.resolve([{ address: "169.254.169.254", family: 4 }]);
    const fetcher = createPinnedFetcher("93.184.216.34", {
      resolver: rebindingResolver,
    });
    await expect(fetcher("https://example.com/")).rejects.toThrow("non-public");
    expect(calls).toHaveLength(0);
  });

  it("connects when the fresh answers still contain the pinned address", async () => {
    const { calls } = installHttpsStub(200);
    const rotatingResolver: TargetAddressResolver = () =>
      Promise.resolve([
        { address: "93.184.216.34", family: 4 },
        { address: "93.184.216.35", family: 4 },
      ]);
    const fetcher = createPinnedFetcher("93.184.216.34", {
      resolver: rotatingResolver,
    });
    const response = await fetcher("https://example.com/", { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it("rejects non-HTTPS input without resolving", async () => {
    const { calls } = installHttpsStub(200);
    const fetcher = createPinnedFetcher("93.184.216.34", {
      resolver: publicResolver,
    });
    await expect(fetcher("http://example.com/")).rejects.toThrow("HTTPS");
    expect(calls).toHaveLength(0);
  });

  it("surfaces transport errors", async () => {
    mockedRequest.mockImplementation(() => {
      const request = {
        end: vi.fn(),
        on: vi.fn((event: string, handler: (error: Error) => void) => {
          if (event === "error") handler(new Error("socket hang up"));
          return request;
        }),
      } as unknown as ClientRequest;
      return request;
    });
    const fetcher = createPinnedFetcher("93.184.216.34", {
      resolver: publicResolver,
    });
    await expect(fetcher("https://example.com/")).rejects.toThrow(
      "socket hang up",
    );
  });
});
