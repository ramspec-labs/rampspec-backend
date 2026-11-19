export const MAX_CONTENT_TYPE_LENGTH = 128;

const MEDIA_TYPE_PATTERN =
  /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u;

const BARE_SUBTYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*$/u;

function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Normalizes a raw Content-Type header value to its media type, or null when
 * the value is absent, over the length bound, or not a well-formed media type.
 * Parameters (for example `; charset=utf-8`) are stripped, the type is
 * lower-cased, and any value containing control characters (CR, LF, NUL) is
 * rejected so a hostile header can never smuggle a second header or a log
 * line through a recorded content type.
 */
export function normalizeContentType(
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== "string") return null;
  if (raw.length === 0 || raw.length > MAX_CONTENT_TYPE_LENGTH) return null;
  if (hasControlCharacter(raw)) return null;
  const mediaType = raw.split(";")[0]?.trim().toLowerCase() ?? "";
  if (mediaType.length === 0) return null;
  if (!MEDIA_TYPE_PATTERN.test(mediaType)) return null;
  return mediaType;
}

/**
 * Reads a Content-Type header from a plain header record without assuming
 * the caller's key casing, and returns its normalized media type (or null
 * when the header is absent or unusable). Only the normalized value is ever
 * returned; the raw header is never persisted.
 */
export function lookupContentType(
  headers: Readonly<Record<string, string>>,
): string | null {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "content-type") {
      return normalizeContentType(value);
    }
  }
  return null;
}

/**
 * Reports whether a normalized media type satisfies an expected content type.
 * A full expected media type (`application/json`) must match exactly. A bare
 * subtype (`json`) matches the subtype itself or a structured-syntax suffix
 * (`application/problem+json`). Anything else never matches, so a raw
 * substring check can no longer mistake `text/notjson` for JSON.
 */
export function contentTypeMatches(
  actual: string | null,
  expected: string,
): boolean {
  if (actual === null) return false;
  const wanted = expected.trim().toLowerCase();
  if (wanted.length === 0 || wanted.length > MAX_CONTENT_TYPE_LENGTH) {
    return false;
  }
  if (hasControlCharacter(wanted)) return false;
  if (wanted.includes("/")) {
    return MEDIA_TYPE_PATTERN.test(wanted) && actual === wanted;
  }
  if (!BARE_SUBTYPE_PATTERN.test(wanted)) return false;
  const subtype = actual.split("/")[1] ?? "";
  return subtype === wanted || subtype.endsWith(`+${wanted}`);
}
