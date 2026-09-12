declare const utcTimestampBrand: unique symbol;
export type UtcTimestamp = string & { readonly [utcTimestampBrand]: true };

export function toUtcTimestamp(value: Date): UtcTimestamp {
  if (Number.isNaN(value.getTime())) {
    throw new TypeError("Cannot serialize an invalid date.");
  }
  return value.toISOString() as UtcTimestamp;
}

export function parseUtcTimestamp(value: unknown): UtcTimestamp {
  if (typeof value !== "string" || !value.endsWith("Z")) {
    throw new TypeError("Timestamp must be a canonical UTC string.");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(
      "Timestamp must use canonical ISO 8601 UTC serialization.",
    );
  }
  return value as UtcTimestamp;
}
