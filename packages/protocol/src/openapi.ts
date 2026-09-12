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
      OrganizationPathId: {
        in: "path",
        name: "organizationId",
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
      Organization: {
        additionalProperties: false,
        properties: {
          createdAt: { $ref: "#/components/schemas/UtcTimestamp" },
          id: { $ref: "#/components/schemas/OrganizationId" },
          name: { minLength: 1, type: "string" },
          ownerUserId: { minLength: 1, type: "string" },
          policy: {
            additionalProperties: false,
            properties: {
              allowPubnet: { type: "boolean" },
              evidenceRetentionDays: { maximum: 3650, minimum: 1, type: "integer" },
              reportSigningKeyRef: { minLength: 1, type: "string" },
            },
            required: ["allowPubnet", "evidenceRetentionDays"],
            type: "object",
          },
          slug: { pattern: "^[a-z][a-z0-9-]{2,62}$", type: "string" },
          status: { enum: ["active", "suspended", "deleted"], type: "string" },
          updatedAt: { $ref: "#/components/schemas/UtcTimestamp" },
        },
        required: ["id", "slug", "name", "ownerUserId", "policy", "status", "createdAt", "updatedAt"],
        type: "object",
      },
      OrganizationPolicy: {
        additionalProperties: false,
        properties: {
          allowPubnet: { type: "boolean" },
          evidenceRetentionDays: { maximum: 3650, minimum: 1, type: "integer" },
          reportSigningKeyRef: { minLength: 1, type: "string" },
        },
        required: ["allowPubnet", "evidenceRetentionDays"],
        type: "object",
      },
      OrganizationUpdate: {
        additionalProperties: false,
        minProperties: 1,
        properties: {
          name: { maxLength: 200, minLength: 1, type: "string" },
          policy: { $ref: "#/components/schemas/OrganizationPolicy" },
          slug: { pattern: "^[a-z][a-z0-9-]{2,62}$", type: "string" },
        },
        type: "object",
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
    "/v1/organizations": {
      get: {
        operationId: "listOrganizations",
        parameters: [{ $ref: "#/components/parameters/Cursor" }],
        responses: {
          "200": jsonResponse("A page of organizations.", {
            additionalProperties: false,
            properties: {
              items: { items: { $ref: "#/components/schemas/Organization" }, type: "array" },
              nextCursor: { oneOf: [{ $ref: "#/components/schemas/OpaqueCursor" }, { type: "null" }] },
            },
            required: ["items", "nextCursor"],
            type: "object",
          }),
          "401": { $ref: "#/components/responses/Problem" },
        },
        summary: "List organizations",
        tags: ["Organizations"],
      },
      post: {
        operationId: "createOrganization",
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                additionalProperties: false,
                properties: {
                  name: { minLength: 1, type: "string" },
                  ownerUserId: { minLength: 1, type: "string" },
                  policy: { $ref: "#/components/schemas/OrganizationPolicy" },
                  slug: { pattern: "^[a-z][a-z0-9-]{2,62}$", type: "string" },
                },
                required: ["name", "ownerUserId", "policy", "slug"],
                type: "object",
              },
            },
          },
          required: true,
        },
        responses: {
          "201": jsonResponse("Organization created.", { $ref: "#/components/schemas/Organization" }),
          "400": { $ref: "#/components/responses/Problem" },
          "401": { $ref: "#/components/responses/Problem" },
          "409": { $ref: "#/components/responses/Problem" },
        },
        summary: "Create an organization",
        tags: ["Organizations"],
      },
    },
    "/v1/organizations/{organizationId}": {
      delete: {
        operationId: "deleteOrganization",
        parameters: [...mutationOperationParameters, { $ref: "#/components/parameters/OrganizationPathId" }],
        responses: {
          "204": { description: "Organization deleted.", headers: { "X-Request-Id": requestIdHeader } },
          "401": { $ref: "#/components/responses/Problem" },
          "403": { $ref: "#/components/responses/Problem" },
          "404": { $ref: "#/components/responses/Problem" },
        },
        summary: "Delete an organization",
        tags: ["Organizations"],
      },
      get: {
        operationId: "getOrganization",
        parameters: [...protectedOperationParameters, { $ref: "#/components/parameters/OrganizationPathId" }],
        responses: {
          "200": jsonResponse("Organization details.", { $ref: "#/components/schemas/Organization" }),
          "401": { $ref: "#/components/responses/Problem" },
          "404": { $ref: "#/components/responses/Problem" },
        },
        summary: "Get an organization",
        tags: ["Organizations"],
      },
      patch: {
        operationId: "updateOrganization",
        parameters: [...mutationOperationParameters, { $ref: "#/components/parameters/OrganizationPathId" }],
        requestBody: {
          content: { "application/json": { schema: { $ref: "#/components/schemas/OrganizationUpdate" } } },
          required: true,
        },
        responses: {
          "200": jsonResponse("Organization updated.", { $ref: "#/components/schemas/Organization" }),
          "400": { $ref: "#/components/responses/Problem" },
          "401": { $ref: "#/components/responses/Problem" },
          "403": { $ref: "#/components/responses/Problem" },
          "404": { $ref: "#/components/responses/Problem" },
        },
        summary: "Update an organization",
        tags: ["Organizations"],
      },
    },
    "/v1/organizations/{organizationId}/members": {
      post: {
        operationId: "inviteOrganizationMember",
        parameters: [...mutationOperationParameters, { $ref: "#/components/parameters/OrganizationPathId" }],
        requestBody: {
          content: { "application/json": { schema: { additionalProperties: false, properties: { role: { enum: ["admin", "auditor", "maintainer", "runner", "viewer"], type: "string" }, userId: { type: "string" } }, required: ["userId", "role"], type: "object" } } },
          required: true,
        },
        responses: {
          "202": { description: "Invitation accepted for delivery.", headers: { "X-Request-Id": requestIdHeader } },
          "400": { $ref: "#/components/responses/Problem" },
          "401": { $ref: "#/components/responses/Problem" },
          "403": { $ref: "#/components/responses/Problem" },
        },
        summary: "Invite an organization member",
        tags: ["Organizations"],
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
    {
      description: "Tenant organizations and membership lifecycle.",
      name: "Organizations",
    },
  ],
} as const;
