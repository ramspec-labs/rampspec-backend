export interface NormalizeOriginOptions {
  readonly allowHttpLoopback?: boolean;
}

function isLoopback(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized.startsWith("127.")
  );
}

export function normalizeOrigin(
  value: unknown,
  options: NormalizeOriginOptions = {},
): string {
  if (typeof value !== "string") {
    throw new TypeError("Origin must be a string.");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Origin must be an absolute URL.");
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError(
      "Origin cannot contain credentials, a query, or a fragment.",
    );
  }
  if (url.pathname !== "/") {
    throw new TypeError("Origin cannot contain a path.");
  }
  if (url.protocol !== "https:") {
    if (!(
      url.protocol === "http:" &&
      options.allowHttpLoopback &&
      isLoopback(url.hostname)
    )) {
      throw new TypeError("Origin must use HTTPS.");
    }
  }

  const hostname = url.hostname.endsWith(".")
    ? url.hostname.slice(0, -1)
    : url.hostname;
  return `${url.protocol}//${hostname.toLowerCase()}${url.port ? `:${url.port}` : ""}`;
}
