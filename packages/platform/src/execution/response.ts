import {
  contentTypeMatches,
  lookupContentType,
} from "./content-type.js";

export interface ResponseExpectation {
  readonly status: readonly number[];
  readonly contentType?: string;
  readonly requiredJsonKeys?: readonly string[];
}

export interface ResponseValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly json: unknown;
}

export function validateProtocolResponse(
  response: {
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
  },
  expectation: ResponseExpectation,
): ResponseValidation {
  const errors: string[] = [];
  if (!expectation.status.includes(response.status)) {
    errors.push(`Unexpected status ${response.status}.`);
  }
  if (
    expectation.contentType &&
    !contentTypeMatches(
      lookupContentType(response.headers),
      expectation.contentType,
    )
  ) {
    errors.push("Unexpected content type.");
  }
  let json: unknown = undefined;
  if (expectation.requiredJsonKeys?.length) {
    try {
      json = JSON.parse(response.body);
    } catch {
      errors.push("Response body is not valid JSON.");
    }
    if (json && typeof json === "object" && !Array.isArray(json)) {
      for (const key of expectation.requiredJsonKeys) {
        if (!(key in json)) errors.push(`Missing JSON key ${key}.`);
      }
    }
  }
  return { errors, json, valid: errors.length === 0 };
}
