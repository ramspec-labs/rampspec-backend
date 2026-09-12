export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
  readonly instance?: string;
  readonly requestId?: string;
  readonly [extension: string]: unknown;
}

export interface ProblemContext {
  readonly instance?: string;
  readonly requestId?: string;
}

const reservedMembers = new Set([
  "detail",
  "instance",
  "status",
  "title",
  "type",
]);

export class DomainError extends Error {
  readonly code: string;
  readonly extensions: Readonly<Record<string, boolean | number | string>>;
  readonly status: number;
  readonly title: string;

  constructor(options: {
    readonly code: string;
    readonly detail: string;
    readonly extensions?: Readonly<Record<string, boolean | number | string>>;
    readonly status: number;
    readonly title: string;
  }) {
    super(options.detail);
    this.name = "DomainError";
    this.code = options.code;
    this.extensions = Object.freeze({ ...(options.extensions ?? {}) });
    this.status = options.status;
    this.title = options.title;

    if (!/^[a-z][a-z0-9-]*$/u.test(this.code)) {
      throw new TypeError("Domain error code must be lowercase kebab-case.");
    }
    if (
      !Number.isInteger(this.status) ||
      this.status < 400 ||
      this.status > 599
    ) {
      throw new RangeError("Domain error status must be an HTTP error status.");
    }
    for (const key of Object.keys(this.extensions)) {
      if (reservedMembers.has(key)) {
        throw new TypeError(`Problem extension ${key} is reserved.`);
      }
    }
  }
}

export function toProblemDetails(
  error: unknown,
  context: ProblemContext = {},
): ProblemDetails {
  if (!(error instanceof DomainError)) {
    return {
      ...(context.instance === undefined ? {} : { instance: context.instance }),
      ...(context.requestId === undefined
        ? {}
        : { requestId: context.requestId }),
      status: 500,
      title: "Internal Server Error",
      type: "about:blank",
    };
  }

  return {
    ...error.extensions,
    ...(context.instance === undefined ? {} : { instance: context.instance }),
    ...(context.requestId === undefined
      ? {}
      : { requestId: context.requestId }),
    detail: error.message,
    status: error.status,
    title: error.title,
    type: `https://rampspec.dev/problems/${error.code}`,
  };
}
