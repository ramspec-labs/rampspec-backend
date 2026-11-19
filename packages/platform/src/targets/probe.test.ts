import { describe, expect, it, vi } from "vitest";
import {
  PROBE_MAX_HEADER_VALUE_BYTES,
  PROBE_MAX_RESPONSE_BYTES,
  PROBE_MAX_SUPPORTED_SEPS,
  PROBE_MAX_TOTAL_HEADER_BYTES,
  ACCEPTED_DISCOVERY_CONTENT_TYPES,
  probeTarget,
} from "./probe.js";

const clock = () => new Date("2026-09-12T18:00:00.000Z");
const SENTINEL = "PROBE-SENTINEL-DO-NOT-LEAK-7f3a9";

/** A stream of `count` chunks of `size` bytes; tracks how many were pulled. */
function chunkStream(
  count: number,
  size: number,
  fill = "a",
): { body: ReadableStream<Uint8Array>; pulled: () => number } {
  let pulled = 0;
  const chunk = new TextEncoder().encode(fill.repeat(size));
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled += 1;
      if (pulled <= count) {
        controller.enqueue(chunk);
      } else {
        controller.close();
      }
    },
  });
  return { body, pulled: () => pulled };
}

function fakeResponse(
  headers: ReadonlyArray<readonly [string, string]>,
  status = 200,
): Response {
  return {
    headers,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

describe("target capability probe", () => {
  it("captures bounded protocol headers", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: {
          "x-stellar-toml-version": "SEP-0001, SEP-0012",
          server: "hidden",
        },
      }),
    );
    const result = await probeTarget("https://example.com", { fetcher, clock });
    expect(result.reachable).toBe(true);
    expect(result.supportedSeps).toEqual(["SEP-0001", "SEP-0012"]);
    expect(result.headers).not.toHaveProperty("server");
    expect(result.budgetExceeded).toBe(false);
    expect(result.limitReason).toBeNull();
  });

  it("fails closed for unsafe and unreachable targets", async () => {
    const fetcher = vi.fn();
    await expect(
      probeTarget("http://example.com", { fetcher }),
    ).rejects.toThrow("HTTPS");
    expect(fetcher).not.toHaveBeenCalled();
    const result = await probeTarget("https://example.com", {
      fetcher: vi.fn().mockRejectedValue(new Error("timeout")),
    });
    expect(result.reachable).toBe(false);
    expect(result.status).toBeNull();
    expect(result.budgetExceeded).toBe(false);
    expect(result.limitReason).toBeNull();
    expect(result.contentType).toBeNull();
    expect(result.contentTypeStatus).toBe("missing");
    expect(result.contentTypeSupported).toBe(false);
    expect(result.discoveryValid).toBe(false);
  });

  it("drains a small response body and stays reachable", async () => {
    const { body } = chunkStream(2, 16);
    const fetcher = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { "x-stellar-toml-version": "SEP-0001" },
      }),
    );
    const result = await probeTarget("https://example.com", { fetcher, clock });
    expect(result.reachable).toBe(true);
    expect(result.status).toBe(200);
    expect(result.supportedSeps).toEqual(["SEP-0001"]);
    expect(result.budgetExceeded).toBe(false);
  });

  it("accepts a body exactly at the response budget", async () => {
    const { body } = chunkStream(4, PROBE_MAX_RESPONSE_BYTES / 4);
    const fetcher = vi.fn().mockResolvedValue(
      new Response(body, { status: 200 }),
    );
    const result = await probeTarget("https://example.com", { fetcher, clock });
    expect(result.reachable).toBe(true);
    expect(result.budgetExceeded).toBe(false);
  });

  it("accepts a declared content length exactly at the budget", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { "content-length": String(PROBE_MAX_RESPONSE_BYTES) },
      }),
    );
    const result = await probeTarget("https://example.com", { fetcher, clock });
    expect(result.reachable).toBe(true);
    expect(result.budgetExceeded).toBe(false);
  });

  it("accepts a header value exactly at the per-value budget", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: {
          "x-stellar-toml-version": "x".repeat(PROBE_MAX_HEADER_VALUE_BYTES),
        },
      }),
    );
    const result = await probeTarget("https://example.com", { fetcher, clock });
    expect(result.reachable).toBe(true);
    expect(result.budgetExceeded).toBe(false);
  });

  it("caps retained SEP identifiers at the configured maximum", async () => {
    const seps = Array.from(
      { length: PROBE_MAX_SUPPORTED_SEPS + 8 },
      (_, index) => `SEP-${String(index + 1).padStart(4, "0")}`,
    ).join(", ");
    const fetcher = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { "x-stellar-toml-version": seps },
      }),
    );
    const result = await probeTarget("https://example.com", { fetcher, clock });
    expect(result.supportedSeps).toHaveLength(PROBE_MAX_SUPPORTED_SEPS);
    expect(result.supportedSeps[0]).toBe("SEP-0001");
    expect(result.budgetExceeded).toBe(false);
  });

  it("aborts a body over the response budget and discards it", async () => {
    const { body, pulled } = chunkStream(10, 10_240, SENTINEL.slice(0, 8));
    const fetcher = vi.fn().mockResolvedValue(
      new Response(body, { status: 200 }),
    );
    const result = await probeTarget("https://example.com", { fetcher, clock });
    expect(result.reachable).toBe(false);
    expect(result.status).toBe(200);
    expect(result.headers).toEqual({});
    expect(result.supportedSeps).toEqual([]);
    expect(result.budgetExceeded).toBe(true);
    expect(result.limitReason).toBe("response-budget-exceeded");
    expect(JSON.stringify(result)).not.toContain(SENTINEL.slice(0, 8));
    // The stream was abandoned mid-response instead of fully consumed.
    expect(pulled()).toBeLessThan(10);
  });

  it("refuses an over-budget declared content length without reading the body", async () => {
    const getReader = vi.fn();
    const cancel = vi.fn(() => Promise.resolve());
    const fakeResponse = {
      body: { cancel, getReader },
      headers: new Headers({
        "content-length": String(PROBE_MAX_RESPONSE_BYTES + 1),
      }),
      ok: true,
      status: 200,
    };
    const fetcher = vi.fn().mockResolvedValue(fakeResponse);
    const result = await probeTarget("https://example.com", { fetcher, clock });
    expect(result.reachable).toBe(false);
    expect(result.status).toBe(200);
    expect(result.budgetExceeded).toBe(true);
    expect(result.limitReason).toBe("content-length-budget-exceeded");
    expect(getReader).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
  });

  it("aborts an oversized retained header value and discards it", async () => {
    const oversized = `${SENTINEL}-${"x".repeat(PROBE_MAX_HEADER_VALUE_BYTES)}`;
    const fetcher = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { "x-stellar-toml-version": oversized },
      }),
    );
    const result = await probeTarget("https://example.com", { fetcher, clock });
    expect(result.reachable).toBe(false);
    expect(result.headers).toEqual({});
    expect(result.supportedSeps).toEqual([]);
    expect(result.budgetExceeded).toBe(true);
    expect(result.limitReason).toBe("header-budget-exceeded");
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
  });

  it("aborts when retained headers exceed their combined budget", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: {
          "content-type": "a".repeat(5000),
          "x-stellar-toml-version": "b".repeat(5000),
        },
      }),
    );
    const result = await probeTarget("https://example.com", {
      fetcher,
      clock,
      maxHeaderValueBytes: 6000,
      maxKeptHeaderBytes: 8000,
    });
    expect(result.reachable).toBe(false);
    expect(result.budgetExceeded).toBe(true);
    expect(result.limitReason).toBe("header-budget-exceeded");
  });

  it("aborts when dropped headers flood the total header budget", async () => {
    const headers: Record<string, string> = {};
    for (let index = 0; index < 100; index += 1) {
      headers[`x-junk-${index}`] = "x".repeat(1000);
    }
    const fetcher = vi.fn().mockResolvedValue(
      new Response(null, { status: 200, headers }),
    );
    const result = await probeTarget("https://example.com", { fetcher, clock });
    expect(result.reachable).toBe(false);
    expect(result.budgetExceeded).toBe(true);
    expect(result.limitReason).toBe("header-budget-exceeded");
    expect(JSON.stringify(result)).not.toContain("x-junk-");
  });

  it("enforces the total header budget at its boundary", async () => {
    const headers = { "x-junk-a": "x".repeat(60), "x-junk-b": "y".repeat(60) };
    const within = await probeTarget("https://example.com", {
      fetcher: vi.fn().mockResolvedValue(
        new Response(null, { status: 200, headers }),
      ),
      clock,
      maxTotalHeaderBytes: 140,
    });
    expect(within.reachable).toBe(true);
    expect(within.budgetExceeded).toBe(false);
    const over = await probeTarget("https://example.com", {
      fetcher: vi.fn().mockResolvedValue(
        new Response(null, { status: 200, headers }),
      ),
      clock,
      maxTotalHeaderBytes: 100,
    });
    expect(over.reachable).toBe(false);
    expect(over.limitReason).toBe("header-budget-exceeded");
    expect(PROBE_MAX_TOTAL_HEADER_BYTES).toBe(65_536);
  });

  it("honours caller-supplied response budgets", async () => {
    const { body } = chunkStream(2, 16);
    const fetcher = vi.fn().mockResolvedValue(
      new Response(body, { status: 200 }),
    );
    const result = await probeTarget("https://example.com", {
      fetcher,
      clock,
      maxResponseBytes: 10,
    });
    expect(result.reachable).toBe(false);
    expect(result.limitReason).toBe("response-budget-exceeded");
  });

  it("rejects non-positive budgets instead of probing unbounded", async () => {
    await expect(
      probeTarget("https://example.com", { maxResponseBytes: 0 }),
    ).rejects.toThrow("positive");
    await expect(
      probeTarget("https://example.com", { maxHeaderValueBytes: -1 }),
    ).rejects.toThrow("positive");
  });

  it("fails closed with no content when the body stream errors", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("partial"));
        controller.error(new Error("connection reset"));
      },
    });
    const fetcher = vi.fn().mockResolvedValue(
      new Response(body, { status: 200 }),
    );
    const result = await probeTarget("https://example.com", { fetcher, clock });
    expect(result.reachable).toBe(false);
    expect(result.status).toBe(200);
    expect(result.headers).toEqual({});
    expect(result.supportedSeps).toEqual([]);
    expect(result.budgetExceeded).toBe(false);
    expect(result.limitReason).toBeNull();
  });

  it("never exposes oversized partial content in the probe result", async () => {
    const { body } = chunkStream(10, 10_240, SENTINEL);
    const fetcher = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { "x-stellar-toml-version": "SEP-0001" },
      }),
    );
    const result = await probeTarget("https://example.com", { fetcher, clock });
    expect(result.limitReason).toBe("response-budget-exceeded");
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
    expect(JSON.stringify(result)).not.toContain("SEP-0001");
  });

  it("accepts the defined discovery content types", async () => {
    expect([...ACCEPTED_DISCOVERY_CONTENT_TYPES]).toEqual([
      "application/json",
      "text/plain",
    ]);
    for (const contentType of ACCEPTED_DISCOVERY_CONTENT_TYPES) {
      const result = await probeTarget("https://example.com", {
        clock,
        fetcher: vi.fn().mockResolvedValue(
          new Response(null, {
            headers: { "content-type": contentType },
            status: 200,
          }),
        ),
      });
      expect(result.contentType).toBe(contentType);
      expect(result.contentTypeStatus).toBe("accepted");
      expect(result.contentTypeSupported).toBe(true);
      expect(result.discoveryValid).toBe(true);
      expect(result.reachable).toBe(true);
    }
  });

  it("normalizes content types case-insensitively and strips parameters", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(null, {
        headers: { "Content-Type": "Text/Plain; charset=UTF-8" },
        status: 200,
      }),
    );
    const result = await probeTarget("https://example.com", { fetcher, clock });
    expect(result.contentType).toBe("text/plain");
    expect(result.contentTypeStatus).toBe("accepted");
    expect(result.discoveryValid).toBe(true);
    // Only the normalized value is recorded, never the raw header.
    expect(result.headers["content-type"]).toBe("text/plain");
  });

  it("distinguishes unsupported content from a valid discovery response", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(null, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "x-stellar-toml-version": "SEP-0001",
        },
        status: 200,
      }),
    );
    const result = await probeTarget("https://example.com", { fetcher, clock });
    expect(result.reachable).toBe(true);
    expect(result.status).toBe(200);
    expect(result.contentType).toBe("text/html");
    expect(result.contentTypeStatus).toBe("unsupported");
    expect(result.contentTypeSupported).toBe(false);
    expect(result.discoveryValid).toBe(false);
    expect(result.supportedSeps).toEqual(["SEP-0001"]);
  });

  it("falls back safely when the content type is missing", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(null, {
        headers: { "x-stellar-toml-version": "SEP-0001" },
        status: 200,
      }),
    );
    const result = await probeTarget("https://example.com", { fetcher, clock });
    expect(result.reachable).toBe(true);
    expect(result.contentType).toBeNull();
    expect(result.contentTypeStatus).toBe("missing");
    expect(result.contentTypeSupported).toBe(false);
    expect(result.discoveryValid).toBe(false);
    expect(result.headers).not.toHaveProperty("content-type");
  });

  it("rejects injected header values without persisting them", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      fakeResponse([
        ["Content-Type", "text/plain\r\nX-Injected: evil"],
        ["X-Stellar-Toml-Version", "SEP-0001"],
      ]),
    );
    const result = await probeTarget("https://example.com", { fetcher, clock });
    expect(result.contentType).toBeNull();
    expect(result.contentTypeStatus).toBe("malformed");
    expect(result.contentTypeSupported).toBe(false);
    expect(result.discoveryValid).toBe(false);
    expect(result.headers).not.toHaveProperty("content-type");
    expect(result.headers).not.toHaveProperty("x-injected");
    expect(result.supportedSeps).toEqual(["SEP-0001"]);
  });

  it("rejects comma-joined content types as malformed", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      fakeResponse([["content-type", "text/plain, application/json"]]),
    );
    const result = await probeTarget("https://example.com", { fetcher, clock });
    expect(result.contentType).toBeNull();
    expect(result.contentTypeStatus).toBe("malformed");
    expect(result.discoveryValid).toBe(false);
  });

  it("bounds content type values at 128 characters", async () => {
    const atLimit = `text/plain; charset=${"x".repeat(108)}`;
    expect(atLimit).toHaveLength(128);
    const accepted = await probeTarget("https://example.com", {
      clock,
      fetcher: vi.fn().mockResolvedValue(fakeResponse([["content-type", atLimit]])),
    });
    expect(accepted.contentType).toBe("text/plain");
    expect(accepted.contentTypeStatus).toBe("accepted");

    const overLimit = `text/plain; charset=${"x".repeat(109)}`;
    expect(overLimit).toHaveLength(129);
    const rejected = await probeTarget("https://example.com", {
      clock,
      fetcher: vi
        .fn()
        .mockResolvedValue(fakeResponse([["content-type", overLimit]])),
    });
    expect(rejected.contentType).toBeNull();
    expect(rejected.contentTypeStatus).toBe("malformed");
    expect(rejected.discoveryValid).toBe(false);
  });

  it("bounds SEP version headers and drops unsafe entries", async () => {
    const overLong = await probeTarget("https://example.com", {
      clock,
      fetcher: vi.fn().mockResolvedValue(
        fakeResponse([
          ["x-stellar-toml-version", `SEP-0001, ${"x".repeat(2000)}`],
        ]),
      ),
    });
    expect(overLong.supportedSeps).toEqual([]);
    expect(overLong.headers).not.toHaveProperty("x-stellar-toml-version");

    const many = Array.from({ length: 40 }, (_, index) => `SEP-${index + 1}`);
    const capped = await probeTarget("https://example.com", {
      clock,
      fetcher: vi.fn().mockResolvedValue(
        fakeResponse([
          ["content-type", "text/plain"],
          ["x-stellar-toml-version", [...many, "SEP-0001\r\nbad"].join(", ")],
        ]),
      ),
    });
    expect(capped.supportedSeps).toHaveLength(32);
    expect(capped.supportedSeps).not.toContain("SEP-0001\r\nbad");
  });

  it("sends no credentials and strips credentials from the target URL", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(null, {
        headers: { "content-type": "text/plain" },
        status: 200,
      }),
    );
    const result = await probeTarget("https://user:secret@example.com", {
      fetcher,
      clock,
    });
    expect(result.reachable).toBe(true);
    const [url, init] = fetcher.mock.calls[0] as [URL, RequestInit];
    expect(url.username).toBe("");
    expect(url.password).toBe("");
    expect(String(url)).not.toContain("user:secret@");
    expect(init).not.toHaveProperty("credentials", "include");
    expect(init.headers).toBeUndefined();
  });

  it("is deterministic for identical responses", async () => {
    const buildFetcher = () =>
      vi.fn().mockResolvedValue(
        new Response(null, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "x-stellar-toml-version": "SEP-0001",
          },
          status: 200,
        }),
      );
    const first = await probeTarget("https://example.com", {
      clock,
      fetcher: buildFetcher(),
    });
    const second = await probeTarget("https://example.com", {
      clock,
      fetcher: buildFetcher(),
    });
    expect(second).toEqual(first);
  });
});
