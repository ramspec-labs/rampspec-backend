import { describe, expect, it } from "vitest";
import {
  contentTypeMatches,
  lookupContentType,
  MAX_CONTENT_TYPE_LENGTH,
  normalizeContentType,
} from "./content-type.js";

describe("content type normalization", () => {
  it("normalizes case and strips parameters", () => {
    expect(normalizeContentType("Text/Plain; charset=UTF-8")).toBe(
      "text/plain",
    );
    expect(normalizeContentType("  application/json  ")).toBe(
      "application/json",
    );
    expect(normalizeContentType("application/problem+json")).toBe(
      "application/problem+json",
    );
  });

  it("rejects absent, empty, and malformed values", () => {
    expect(normalizeContentType(null)).toBeNull();
    expect(normalizeContentType(undefined)).toBeNull();
    expect(normalizeContentType("")).toBeNull();
    expect(normalizeContentType("   ")).toBeNull();
    expect(normalizeContentType("text")).toBeNull();
    expect(normalizeContentType("text/plain, application/json")).toBeNull();
    expect(normalizeContentType("/plain")).toBeNull();
    expect(normalizeContentType("text/")).toBeNull();
  });

  it("rejects control characters for injection safety", () => {
    expect(normalizeContentType("text/plain\r\nX-Injected: evil")).toBeNull();
    expect(normalizeContentType("text/plain\u0000")).toBeNull();
    expect(normalizeContentType("text/plain\t")).toBeNull();
  });

  it("bounds values at the documented maximum length", () => {
    expect(MAX_CONTENT_TYPE_LENGTH).toBe(128);
    const atLimit = `text/plain; padding=${"x".repeat(108)}`;
    expect(atLimit).toHaveLength(128);
    expect(normalizeContentType(atLimit)).toBe("text/plain");
    expect(normalizeContentType(`${atLimit}x`)).toBeNull();
  });

  it("looks up header names case-insensitively", () => {
    expect(
      lookupContentType({ "Content-Type": "Application/JSON" }),
    ).toBe("application/json");
    expect(lookupContentType({ "X-Other": "text/plain" })).toBeNull();
    expect(lookupContentType({})).toBeNull();
    expect(
      lookupContentType({ "content-type": "text/html\r\nX: y" }),
    ).toBeNull();
  });

  it("matches full media types exactly and bare subtypes safely", () => {
    expect(contentTypeMatches("application/json", "application/json")).toBe(
      true,
    );
    expect(contentTypeMatches("application/json", "Application/JSON")).toBe(
      true,
    );
    expect(contentTypeMatches("application/json", "text/plain")).toBe(false);
    expect(contentTypeMatches("application/json", "json")).toBe(true);
    expect(contentTypeMatches("application/problem+json", "json")).toBe(true);
    expect(contentTypeMatches("application/notjson", "json")).toBe(false);
    expect(contentTypeMatches("application/json", "json; charset=utf-8")).toBe(
      false,
    );
    expect(contentTypeMatches(null, "json")).toBe(false);
    expect(contentTypeMatches("application/json", "")).toBe(false);
    expect(contentTypeMatches("application/json", "json\r\nX: y")).toBe(false);
  });
});
