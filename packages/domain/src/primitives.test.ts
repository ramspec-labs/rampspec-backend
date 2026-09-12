import { Buffer } from "node:buffer";

import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import {
  DomainError,
  addDecimals,
  assertNetworkPassphrase,
  compareDecimals,
  createId,
  knownNetworkPassphrases,
  normalizeOrigin,
  parseDecimal,
  parseId,
  parseStellarAddress,
  parseUtcTimestamp,
  toProblemDetails,
  toUtcTimestamp,
} from "./index.js";

describe("opaque IDs", () => {
  it("creates and validates kind-scoped identifiers", () => {
    const id = createId("run");
    expect(parseId("run", id)).toBe(id);
    expect(() => parseId("project", id)).toThrow("Invalid project ID");
    expect(() => parseId("run", "run_not-a-uuid")).toThrow("Invalid run ID");
  });
});

describe("UTC timestamps", () => {
  it("round-trips canonical UTC values", () => {
    const value = toUtcTimestamp(new Date("2026-09-12T18:03:04.005Z"));
    expect(value).toBe("2026-09-12T18:03:04.005Z");
    expect(parseUtcTimestamp(value)).toBe(value);
  });

  it.each(["2026-09-12T19:03:04+01:00", "2026-09-12T18:03:04Z", "not-a-date"])(
    "rejects non-canonical time %s",
    (value) => {
      expect(() => parseUtcTimestamp(value)).toThrow("Timestamp");
    },
  );
});

describe("exact decimals", () => {
  it("preserves values beyond JavaScript number precision", () => {
    const left = parseDecimal("9007199254740993.1234567", { maxScale: 7 });
    const right = parseDecimal("0.0000003", { maxScale: 7 });
    expect(addDecimals(left, right)).toBe("9007199254740993.123457");
    expect(compareDecimals(left, right)).toBe(1);
    expect(JSON.stringify({ amount: left })).toBe(
      '{"amount":"9007199254740993.1234567"}',
    );
  });

  it.each([1.2, "1e3", "+1", "01", "1.2345678"])(
    "rejects unsafe decimal input %s",
    (value) => {
      expect(() => parseDecimal(value, { maxScale: 6 })).toThrow();
    },
  );

  it("enforces sign and magnitude boundaries", () => {
    expect(() => parseDecimal("-0.01")).toThrow("Negative");
    expect(() => parseDecimal("100.01", { maxAbsolute: "100" })).toThrow(
      "magnitude",
    );
  });
});

describe("Stellar values", () => {
  const account = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7)).publicKey();
  const contract = StrKey.encodeContract(Buffer.alloc(32, 9));

  it("accepts typed public addresses and rejects secret seeds", () => {
    expect(parseStellarAddress("account", account)).toBe(account);
    expect(parseStellarAddress("contract", contract)).toBe(contract);
    const secret = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7)).secret();
    expect(() => parseStellarAddress("account", secret)).toThrow(
      "Invalid Stellar account",
    );
  });

  it("binds known network names to exact passphrases", () => {
    expect(
      assertNetworkPassphrase("testnet", knownNetworkPassphrases.testnet),
    ).toBe(knownNetworkPassphrases.testnet);
    expect(() =>
      assertNetworkPassphrase("pubnet", knownNetworkPassphrases.testnet),
    ).toThrow("does not match pubnet");
  });
});

describe("normalized origins", () => {
  it("canonicalizes case, Unicode domains, trailing dots, and default ports", () => {
    expect(normalizeOrigin("https://EXAMPLE.com.:443/")).toBe(
      "https://example.com",
    );
    expect(normalizeOrigin("https://b\u00fccher.example/")).toBe(
      "https://xn--bcher-kva.example",
    );
  });

  it.each([
    "http://example.com",
    "https://user:secret@example.com",
    "https://example.com/path",
    "https://example.com?next=target",
  ])("rejects unsafe origin %s", (origin) => {
    expect(() => normalizeOrigin(origin)).toThrow();
  });

  it("permits explicit HTTP loopback only", () => {
    expect(
      normalizeOrigin("http://127.0.0.1:3000", { allowHttpLoopback: true }),
    ).toBe("http://127.0.0.1:3000");
  });
});

describe("problem details", () => {
  it("maps domain errors without exposing implementation details", () => {
    const problem = toProblemDetails(
      new DomainError({
        code: "target-not-found",
        detail: "The requested target does not exist.",
        extensions: { targetId: "target_123" },
        status: 404,
        title: "Target Not Found",
      }),
      { instance: "/v1/targets/target_123", requestId: "request_123" },
    );
    expect(problem).toMatchObject({
      requestId: "request_123",
      status: 404,
      targetId: "target_123",
      type: "https://rampspec.dev/problems/target-not-found",
    });
  });

  it("maps unknown errors to an opaque RFC 9457 response", () => {
    const problem = toProblemDetails(new Error("database password leaked"));
    expect(problem).toEqual({
      status: 500,
      title: "Internal Server Error",
      type: "about:blank",
    });
  });

  it("rejects extensions that overwrite standard members", () => {
    expect(
      () =>
        new DomainError({
          code: "bad-input",
          detail: "Bad input.",
          extensions: { status: 200 },
          status: 400,
          title: "Bad Input",
        }),
    ).toThrow("reserved");
  });
});
