const requestIdHeader = {
  description: "Correlates the request across services and audit records.",
  schema: { $ref: "#/components/schemas/RequestId" },
} as const;

export const protectedOperationParameters = [
  { $ref: "#/components/parameters/OrganizationId" },
] as const;

export const mutationOperationParameters = [
  ...protectedOperationParameters,
  { $ref: "#/components/parameters/IdempotencyKey" },
] as const;

export function jsonResponse(
  description: string,
  schema: Readonly<Record<string, unknown>>,
) {
  return {
    content: {
      "application/json": { schema },
    },
    description,
    headers: {
      "X-Request-Id": requestIdHeader,
    },
  } as const;
}

export const openApiDocument = {
  components: {
    headers: {
      RequestId: requestIdHeader,
    },
    parameters: {
      Cursor: {
        description: "Opaque cursor returned by the preceding page.",
        in: "query",
        name: "cursor",
        required: false,
        schema: { $ref: "#/components/schemas/OpaqueCursor" },
      },
      IdempotencyKey: {
        description:
          "Caller-generated key that identifies one mutation request.",
        in: "header",
        name: "Idempotency-Key",
        required: true,
        schema: {
          maxLength: 128,
          minLength: 16,
          pattern: "^[A-Za-z0-9._:-]+$",
          type: "string",
        },
      },
      OrganizationId: {
        description: "Organization tenant for this request.",
        in: "header",
        name: "X-RampSpec-Organization",
        required: true,
        schema: { $ref: "#/components/schemas/OrganizationId" },
      },
    },
    responses: {
      Problem: {
        content: {
          "application/problem+json": {
            schema: { $ref: "#/components/schemas/Problem" },
          },
        },
        description: "The request could not be completed.",
        headers: {
          "X-Request-Id": requestIdHeader,
        },
      },
    },
    schemas: {
      OpaqueCursor: {
        maxLength: 512,
        minLength: 16,
        pattern: "^[A-Za-z0-9_-]+$",
        type: "string",
      },
      OrganizationId: {
        pattern:
          "^organization_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
        type: "string",
      },
      PageInfo: {
        additionalProperties: false,
        properties: {
          nextCursor: {
            oneOf: [
              { $ref: "#/components/schemas/OpaqueCursor" },
              { type: "null" },
            ],
          },
        },
        required: ["nextCursor"],
        type: "object",
      },
      Problem: {
        additionalProperties: true,
        properties: {
          detail: { type: "string" },
          instance: { format: "uri-reference", type: "string" },
          requestId: { $ref: "#/components/schemas/RequestId" },
          status: { maximum: 599, minimum: 400, type: "integer" },
          title: { minLength: 1, type: "string" },
          type: { format: "uri-reference", type: "string" },
        },
        required: ["type", "title", "status"],
        type: "object",
      },
      RequestId: {
        pattern:
          "^request_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
        type: "string",
      },
      UtcTimestamp: {
        format: "date-time",
        pattern:
          "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$",
        type: "string",
      },
    },
    securitySchemes: {
      bearerAuth: {
        bearerFormat: "JWT",
        description: "OIDC access token issued for the RampSpec API audience.",
        scheme: "bearer",
        type: "http",
      },
    },
  },
  info: {
    description:
      "Control-plane API for RampSpec conformance runs. Results are evidence, not certification.",
    license: {
      name: "Apache-2.0",
      url: "https://www.apache.org/licenses/LICENSE-2.0.html",
    },
    title: "RampSpec Backend API",
    version: "0.1.0",
  },
  jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
  openapi: "3.1.0",
  paths: {
    "/health": {
      get: {
        operationId: "getHealth",
        responses: {
          "200": jsonResponse("Service health.", {
            additionalProperties: false,
            properties: { status: { const: "ok", type: "string" } },
            required: ["status"],
            type: "object",
          }),
        },
        security: [],
        summary: "Read service health",
        tags: ["System"],
      },
    },
    "/v1/context": {
      get: {
        operationId: "getRequestContext",
        parameters: protectedOperationParameters,
        responses: {
          "200": jsonResponse("Authenticated request context.", {
            additionalProperties: false,
            properties: {
              organizationId: { $ref: "#/components/schemas/OrganizationId" },
              requestId: { $ref: "#/components/schemas/RequestId" },
            },
            required: ["organizationId", "requestId"],
            type: "object",
          }),
          "401": { $ref: "#/components/responses/Problem" },
          "403": { $ref: "#/components/responses/Problem" },
        },
        summary: "Read authenticated request context",
        tags: ["System"],
      },
    },
  },
  security: [{ bearerAuth: [] }],
  servers: [{ url: "https://api.rampspec.dev" }],
  tags: [
    {
      description: "Service metadata and authenticated context.",
      name: "System",
    },
  ],
} as const;
