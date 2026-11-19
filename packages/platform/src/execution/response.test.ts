import { describe, expect, it } from "vitest";
import { validateProtocolResponse } from "./response.js";

describe("protocol response validation", () => {
  it("validates status, media type, and required JSON keys", () => {
    expect(
      validateProtocolResponse(
        {
          status: 200,
          headers: { "content-type": "application/json" },
          body: '{"ok":true}',
        },
        { status: [200], contentType: "json", requiredJsonKeys: ["ok"] },
      ).valid,
    ).toBe(true);
  });

  it("returns actionable validation errors", () => {
    const result = validateProtocolResponse(
      { status: 500, headers: {}, body: "bad" },
      { status: [200], contentType: "json", requiredJsonKeys: ["ok"] },
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      "Unexpected status 500.",
      "Unexpected content type.",
      "Response body is not valid JSON.",
    ]);
  });

  it("matches content types case-insensitively with parameters stripped", () => {
    const response = {
      status: 200,
      headers: { "Content-Type": "Application/JSON; Charset=UTF-8" },
      body: "{}",
    };
    expect(
      validateProtocolResponse(response, { status: [200], contentType: "json" })
        .valid,
    ).toBe(true);
    expect(
      validateProtocolResponse(response, {
        status: [200],
        contentType: "Application/JSON",
      }).valid,
    ).toBe(true);
    expect(
      validateProtocolResponse(response, {
        status: [200],
        contentType: "application/problem+json",
      }).valid,
    ).toBe(false);
  });

  it("matches structured-syntax suffixes for bare subtype expectations", () => {
    const result = validateProtocolResponse(
      {
        status: 200,
        headers: { "content-type": "application/problem+json" },
        body: "{}",
      },
      { status: [200], contentType: "json" },
    );
    expect(result.valid).toBe(true);
  });

  it("rejects lookalike subtypes instead of substring matching", () => {
    const result = validateProtocolResponse(
      {
        status: 200,
        headers: { "content-type": "application/notjson" },
        body: "{}",
      },
      { status: [200], contentType: "json" },
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(["Unexpected content type."]);
  });

  it("rejects injected and over-long content types", () => {
    const injected = validateProtocolResponse(
      {
        status: 200,
        headers: { "content-type": "application/json\r\nX-Evil: 1" },
        body: "{}",
      },
      { status: [200], contentType: "json" },
    );
    expect(injected.valid).toBe(false);
    expect(injected.errors).toEqual(["Unexpected content type."]);

    const overLong = validateProtocolResponse(
      {
        status: 200,
        headers: {
          "content-type": `application/json; padding=${"x".repeat(200)}`,
        },
        body: "{}",
      },
      { status: [200], contentType: "json" },
    );
    expect(overLong.valid).toBe(false);
    expect(overLong.errors).toEqual(["Unexpected content type."]);
  });
});
