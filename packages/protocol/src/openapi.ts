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
      ProjectPathId: {
        in: "path",
        name: "projectId",
        required: true,
        schema: { $ref: "#/components/schemas/ProjectId" },
      },
      TargetPathId: {
        in: "path",
        name: "targetId",
        required: true,
        schema: { $ref: "#/components/schemas/TargetId" },
      },
      CorridorPathId: {
        in: "path",
        name: "corridorId",
        required: true,
        schema: { $ref: "#/components/schemas/CorridorId" },
      },
      VerificationPathId: {
        in: "path",
        name: "verificationId",
        required: true,
        schema: { $ref: "#/components/schemas/VerificationId" },
      },
      SecretReferencePathId: {
        in: "path",
        name: "secretReferenceId",
        required: true,
        schema: { $ref: "#/components/schemas/SecretReferenceId" },
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
      Project: {
        additionalProperties: false,
        properties: {
          archivedAt: { oneOf: [{ $ref: "#/components/schemas/UtcTimestamp" }, { type: "null" }] },
          createdAt: { $ref: "#/components/schemas/UtcTimestamp" },
          id: { $ref: "#/components/schemas/ProjectId" },
          name: { maxLength: 200, minLength: 1, type: "string" },
          organizationId: { $ref: "#/components/schemas/OrganizationId" },
          policy: { type: "object" },
          repositoryUrl: { oneOf: [{ format: "uri", pattern: "^https://", type: "string" }, { type: "null" }] },
          slug: { pattern: "^[a-z][a-z0-9-]{2,62}$", type: "string" },
          status: { enum: ["active", "archived"], type: "string" },
          updatedAt: { $ref: "#/components/schemas/UtcTimestamp" },
        },
        required: ["id", "organizationId", "slug", "name", "repositoryUrl", "policy", "status", "archivedAt", "createdAt", "updatedAt"],
        type: "object",
      },
      ProjectId: {
        pattern: "^project_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
        type: "string",
      },
      ProjectUpdate: {
        additionalProperties: false,
        minProperties: 1,
        properties: {
          name: { maxLength: 200, minLength: 1, type: "string" },
          policy: { type: "object" },
          repositoryUrl: { oneOf: [{ format: "uri", pattern: "^https://", type: "string" }, { type: "null" }] },
          slug: { pattern: "^[a-z][a-z0-9-]{2,62}$", type: "string" },
        },
        type: "object",
      },
      AssetId: {
        pattern: "^asset_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
        type: "string",
      },
      Corridor: {
        additionalProperties: false,
        properties: {
          createdAt: { $ref: "#/components/schemas/UtcTimestamp" },
          direction: { enum: ["deposit", "withdrawal", "send", "receive"], type: "string" },
          enabled: { type: "boolean" },
          id: { $ref: "#/components/schemas/CorridorId" },
          inputAssetId: { $ref: "#/components/schemas/AssetId" },
          metadata: { type: "object" },
          methods: { items: { minLength: 1, type: "string" }, maxItems: 64, minItems: 1, type: "array" },
          organizationId: { $ref: "#/components/schemas/OrganizationId" },
          outputAssetId: { $ref: "#/components/schemas/AssetId" },
          targetId: { $ref: "#/components/schemas/TargetId" },
        },
        required: ["id", "organizationId", "targetId", "inputAssetId", "outputAssetId", "direction", "methods", "enabled", "metadata", "createdAt"],
        type: "object",
      },
      CorridorId: {
        pattern: "^corridor_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
        type: "string",
      },
      Target: {
        additionalProperties: false,
        properties: {
          archivedAt: { oneOf: [{ $ref: "#/components/schemas/UtcTimestamp" }, { type: "null" }] },
          createdAt: { $ref: "#/components/schemas/UtcTimestamp" },
          customNetworkId: { oneOf: [{ minLength: 3, type: "string" }, { type: "null" }] },
          expectedMethods: { items: { minLength: 1, type: "string" }, maxItems: 64, type: "array" },
          expectedSeps: { items: { minLength: 1, type: "string" }, maxItems: 128, type: "array" },
          id: { $ref: "#/components/schemas/TargetId" },
          metadata: { type: "object" },
          name: { maxLength: 200, minLength: 1, type: "string" },
          networkPassphrase: { minLength: 1, type: "string" },
          normalizedOrigin: { format: "uri", pattern: "^https://", type: "string" },
          organizationId: { $ref: "#/components/schemas/OrganizationId" },
          projectId: { $ref: "#/components/schemas/ProjectId" },
          runnerPolicy: { type: "object" },
          status: { enum: ["pending_verification", "verified", "suspended", "archived"], type: "string" },
          stellarNetwork: { enum: ["testnet", "pubnet", "futurenet", "custom"], type: "string" },
          updatedAt: { $ref: "#/components/schemas/UtcTimestamp" },
          verifiedUntil: { oneOf: [{ $ref: "#/components/schemas/UtcTimestamp" }, { type: "null" }] },
        },
        required: ["id", "organizationId", "projectId", "name", "normalizedOrigin", "stellarNetwork", "networkPassphrase", "customNetworkId", "expectedSeps", "expectedMethods", "runnerPolicy", "metadata", "status", "verifiedUntil", "archivedAt", "createdAt", "updatedAt"],
        type: "object",
      },
      TargetId: {
        pattern: "^target_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
        type: "string",
      },
      VerificationId: {
        pattern: "^verification_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
        type: "string",
      },
      OwnershipChallenge: {
        additionalProperties: false,
        properties: {
          createdAt: { $ref: "#/components/schemas/UtcTimestamp" },
          evidenceHash: { oneOf: [{ pattern: "^[0-9a-f]{64}$", type: "string" }, { type: "null" }] },
          expiresAt: { $ref: "#/components/schemas/UtcTimestamp" },
          id: { $ref: "#/components/schemas/VerificationId" },
          method: { enum: ["dns_txt", "well_known"], type: "string" },
          organizationId: { $ref: "#/components/schemas/OrganizationId" },
          status: { enum: ["pending", "verified", "expired", "revoked"], type: "string" },
          targetId: { $ref: "#/components/schemas/TargetId" },
          verifiedAt: { oneOf: [{ $ref: "#/components/schemas/UtcTimestamp" }, { type: "null" }] },
        },
        required: ["id", "organizationId", "targetId", "method", "status", "evidenceHash", "expiresAt", "createdAt", "verifiedAt"],
        type: "object",
      },
      SecretReferenceId: {
        pattern: "^secret_reference_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
        type: "string",
      },
      SecretReference: {
        additionalProperties: false,
        properties: {
          createdAt: { $ref: "#/components/schemas/UtcTimestamp" },
          deletedAt: { oneOf: [{ $ref: "#/components/schemas/UtcTimestamp" }, { type: "null" }] },
          id: { $ref: "#/components/schemas/SecretReferenceId" },
          lastUsedAt: { oneOf: [{ $ref: "#/components/schemas/UtcTimestamp" }, { type: "null" }] },
          locatorHash: { pattern: "^[0-9a-f]{64}$", type: "string" },
          name: { pattern: "^[a-z][a-z0-9_-]{2,63}$", type: "string" },
          organizationId: { $ref: "#/components/schemas/OrganizationId" },
          provider: { enum: ["aws", "azure", "gcp", "vault", "local"], type: "string" },
          providerVersion: { oneOf: [{ type: "string" }, { type: "null" }] },
          rotatedAt: { oneOf: [{ $ref: "#/components/schemas/UtcTimestamp" }, { type: "null" }] },
          targetId: { $ref: "#/components/schemas/TargetId" },
        },
        required: ["id", "organizationId", "targetId", "name", "provider", "locatorHash", "providerVersion", "lastUsedAt", "rotatedAt", "deletedAt", "createdAt"],
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
    "/v1/projects": {
      get: {
        operationId: "listProjects",
        parameters: [...protectedOperationParameters, { $ref: "#/components/parameters/Cursor" }],
        responses: {
          "200": jsonResponse("A page of projects.", { additionalProperties: false, properties: { items: { items: { $ref: "#/components/schemas/Project" }, type: "array" }, nextCursor: { oneOf: [{ $ref: "#/components/schemas/OpaqueCursor" }, { type: "null" }] } }, required: ["items", "nextCursor"], type: "object" }),
          "401": { $ref: "#/components/responses/Problem" },
        },
        summary: "List projects",
        tags: ["Projects"],
      },
      post: {
        operationId: "createProject",
        parameters: mutationOperationParameters,
        requestBody: { content: { "application/json": { schema: { additionalProperties: false, properties: { name: { maxLength: 200, minLength: 1, type: "string" }, organizationId: { $ref: "#/components/schemas/OrganizationId" }, policy: { type: "object" }, repositoryUrl: { oneOf: [{ format: "uri", pattern: "^https://", type: "string" }, { type: "null" }] }, slug: { pattern: "^[a-z][a-z0-9-]{2,62}$", type: "string" } }, required: ["name", "organizationId", "slug"], type: "object" } } }, required: true },
        responses: {
          "201": jsonResponse("Project created.", { $ref: "#/components/schemas/Project" }),
          "400": { $ref: "#/components/responses/Problem" },
          "401": { $ref: "#/components/responses/Problem" },
          "409": { $ref: "#/components/responses/Problem" },
        },
        summary: "Create a project",
        tags: ["Projects"],
      },
    },
    "/v1/projects/{projectId}": {
      delete: {
        operationId: "archiveProject",
        parameters: [...mutationOperationParameters, { $ref: "#/components/parameters/ProjectPathId" }],
        responses: { "204": { description: "Project archived.", headers: { "X-Request-Id": requestIdHeader } }, "401": { $ref: "#/components/responses/Problem" }, "403": { $ref: "#/components/responses/Problem" }, "404": { $ref: "#/components/responses/Problem" } },
        summary: "Archive a project",
        tags: ["Projects"],
      },
      get: {
        operationId: "getProject",
        parameters: [...protectedOperationParameters, { $ref: "#/components/parameters/ProjectPathId" }],
        responses: { "200": jsonResponse("Project details.", { $ref: "#/components/schemas/Project" }), "401": { $ref: "#/components/responses/Problem" }, "404": { $ref: "#/components/responses/Problem" } },
        summary: "Get a project",
        tags: ["Projects"],
      },
      patch: {
        operationId: "updateProject",
        parameters: [...mutationOperationParameters, { $ref: "#/components/parameters/ProjectPathId" }],
        requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/ProjectUpdate" } } }, required: true },
        responses: { "200": jsonResponse("Project updated.", { $ref: "#/components/schemas/Project" }), "400": { $ref: "#/components/responses/Problem" }, "401": { $ref: "#/components/responses/Problem" }, "403": { $ref: "#/components/responses/Problem" }, "404": { $ref: "#/components/responses/Problem" } },
        summary: "Update a project",
        tags: ["Projects"],
      },
    },
    "/v1/targets": {
      get: {
        operationId: "listTargets",
        parameters: protectedOperationParameters,
        responses: { "200": jsonResponse("Tenant targets.", { items: { $ref: "#/components/schemas/Target" }, type: "array" }), "401": { $ref: "#/components/responses/Problem" } },
        summary: "List targets",
        tags: ["Targets"],
      },
      post: {
        operationId: "createTarget",
        parameters: mutationOperationParameters,
        requestBody: { content: { "application/json": { schema: { additionalProperties: false, properties: { customNetworkId: { type: "string" }, expectedMethods: { items: { type: "string" }, maxItems: 64, type: "array" }, expectedSeps: { items: { type: "string" }, maxItems: 128, type: "array" }, name: { maxLength: 200, minLength: 1, type: "string" }, networkPassphrase: { minLength: 1, type: "string" }, origin: { format: "uri", pattern: "^https://", type: "string" }, organizationId: { $ref: "#/components/schemas/OrganizationId" }, projectId: { $ref: "#/components/schemas/ProjectId" }, stellarNetwork: { enum: ["testnet", "pubnet", "futurenet", "custom"], type: "string" } }, required: ["organizationId", "projectId", "name", "origin", "stellarNetwork", "networkPassphrase"], type: "object" } } }, required: true },
        responses: { "201": jsonResponse("Target created.", { $ref: "#/components/schemas/Target" }), "400": { $ref: "#/components/responses/Problem" }, "401": { $ref: "#/components/responses/Problem" }, "409": { $ref: "#/components/responses/Problem" } },
        summary: "Create a target",
        tags: ["Targets"],
      },
    },
    "/v1/targets/{targetId}": {
      delete: {
        operationId: "archiveTarget",
        parameters: [...mutationOperationParameters, { $ref: "#/components/parameters/TargetPathId" }],
        responses: { "204": { description: "Target archived.", headers: { "X-Request-Id": requestIdHeader } }, "401": { $ref: "#/components/responses/Problem" }, "403": { $ref: "#/components/responses/Problem" }, "404": { $ref: "#/components/responses/Problem" } },
        summary: "Archive a target",
        tags: ["Targets"],
      },
      get: {
        operationId: "getTarget",
        parameters: [...protectedOperationParameters, { $ref: "#/components/parameters/TargetPathId" }],
        responses: { "200": jsonResponse("Target details.", { $ref: "#/components/schemas/Target" }), "401": { $ref: "#/components/responses/Problem" }, "404": { $ref: "#/components/responses/Problem" } },
        summary: "Get a target",
        tags: ["Targets"],
      },
    },
    "/v1/targets/{targetId}/corridors": {
      get: {
        operationId: "listTargetCorridors",
        parameters: [...protectedOperationParameters, { $ref: "#/components/parameters/TargetPathId" }],
        responses: { "200": jsonResponse("Target corridors.", { items: { $ref: "#/components/schemas/Corridor" }, type: "array" }), "401": { $ref: "#/components/responses/Problem" }, "404": { $ref: "#/components/responses/Problem" } },
        summary: "List target corridors",
        tags: ["Targets"],
      },
      post: {
        operationId: "createTargetCorridor",
        parameters: [...mutationOperationParameters, { $ref: "#/components/parameters/TargetPathId" }],
        requestBody: { content: { "application/json": { schema: { additionalProperties: false, properties: { direction: { enum: ["deposit", "withdrawal", "send", "receive"], type: "string" }, inputAssetId: { $ref: "#/components/schemas/AssetId" }, methods: { items: { type: "string" }, maxItems: 64, minItems: 1, type: "array" }, outputAssetId: { $ref: "#/components/schemas/AssetId" } }, required: ["inputAssetId", "outputAssetId", "direction", "methods"], type: "object" } } }, required: true },
        responses: { "201": jsonResponse("Corridor created.", { $ref: "#/components/schemas/Corridor" }), "400": { $ref: "#/components/responses/Problem" }, "401": { $ref: "#/components/responses/Problem" }, "404": { $ref: "#/components/responses/Problem" }, "409": { $ref: "#/components/responses/Problem" } },
        summary: "Create a target corridor",
        tags: ["Targets"],
      },
    },
    "/v1/corridors/{corridorId}": {
      patch: {
        operationId: "setCorridorEnabled",
        parameters: [...mutationOperationParameters, { $ref: "#/components/parameters/CorridorPathId" }],
        requestBody: { content: { "application/json": { schema: { additionalProperties: false, properties: { enabled: { type: "boolean" } }, required: ["enabled"], type: "object" } } }, required: true },
        responses: { "200": jsonResponse("Corridor updated.", { $ref: "#/components/schemas/Corridor" }), "400": { $ref: "#/components/responses/Problem" }, "401": { $ref: "#/components/responses/Problem" }, "404": { $ref: "#/components/responses/Problem" } },
        summary: "Enable or disable a corridor",
        tags: ["Targets"],
      },
    },
    "/v1/targets/{targetId}/ownership-challenges": {
      get: {
        operationId: "listOwnershipChallenges",
        parameters: [...protectedOperationParameters, { $ref: "#/components/parameters/TargetPathId" }],
        responses: { "200": jsonResponse("Ownership challenges.", { items: { $ref: "#/components/schemas/OwnershipChallenge" }, type: "array" }), "401": { $ref: "#/components/responses/Problem" }, "404": { $ref: "#/components/responses/Problem" } },
        summary: "List ownership challenges",
        tags: ["Targets"],
      },
      post: {
        operationId: "createOwnershipChallenge",
        parameters: [...mutationOperationParameters, { $ref: "#/components/parameters/TargetPathId" }],
        requestBody: { content: { "application/json": { schema: { additionalProperties: false, properties: { method: { enum: ["dns_txt", "well_known"], type: "string" }, ttlSeconds: { maximum: 86400, minimum: 60, type: "integer" } }, required: ["method"], type: "object" } } }, required: true },
        responses: { "201": jsonResponse("Ownership challenge created.", { additionalProperties: false, properties: { challenge: { $ref: "#/components/schemas/OwnershipChallenge" }, token: { minLength: 1, type: "string" } }, required: ["challenge", "token"], type: "object" }), "400": { $ref: "#/components/responses/Problem" }, "401": { $ref: "#/components/responses/Problem" }, "409": { $ref: "#/components/responses/Problem" } },
        summary: "Create an ownership challenge",
        tags: ["Targets"],
      },
    },
    "/v1/ownership-challenges/{verificationId}": {
      delete: {
        operationId: "revokeOwnershipChallenge",
        parameters: [...mutationOperationParameters, { $ref: "#/components/parameters/VerificationPathId" }],
        responses: { "204": { description: "Ownership challenge revoked.", headers: { "X-Request-Id": requestIdHeader } }, "401": { $ref: "#/components/responses/Problem" }, "403": { $ref: "#/components/responses/Problem" }, "404": { $ref: "#/components/responses/Problem" } },
        summary: "Revoke an ownership challenge",
        tags: ["Targets"],
      },
      post: {
        operationId: "verifyOwnershipChallenge",
        parameters: [...mutationOperationParameters, { $ref: "#/components/parameters/VerificationPathId" }],
        requestBody: { content: { "application/json": { schema: { additionalProperties: false, properties: { evidence: { type: "string" }, token: { minLength: 1, type: "string" } }, required: ["token"], type: "object" } } }, required: true },
        responses: { "200": jsonResponse("Ownership verified.", { $ref: "#/components/schemas/OwnershipChallenge" }), "400": { $ref: "#/components/responses/Problem" }, "401": { $ref: "#/components/responses/Problem" }, "403": { $ref: "#/components/responses/Problem" }, "404": { $ref: "#/components/responses/Problem" } },
        summary: "Verify an ownership challenge",
        tags: ["Targets"],
      },
    },
    "/v1/targets/{targetId}/secret-references": {
      get: {
        operationId: "listSecretReferences",
        parameters: [...protectedOperationParameters, { $ref: "#/components/parameters/TargetPathId" }],
        responses: { "200": jsonResponse("Secret references.", { items: { $ref: "#/components/schemas/SecretReference" }, type: "array" }), "401": { $ref: "#/components/responses/Problem" }, "404": { $ref: "#/components/responses/Problem" } },
        summary: "List secret references",
        tags: ["Targets"],
      },
      post: {
        operationId: "createSecretReference",
        parameters: [...mutationOperationParameters, { $ref: "#/components/parameters/TargetPathId" }],
        requestBody: { content: { "application/json": { schema: { additionalProperties: false, properties: { locatorHash: { pattern: "^[0-9a-f]{64}$", type: "string" }, name: { pattern: "^[a-z][a-z0-9_-]{2,63}$", type: "string" }, provider: { enum: ["aws", "azure", "gcp", "vault", "local"], type: "string" }, providerVersion: { type: "string" } }, required: ["name", "provider", "locatorHash"], type: "object" } } }, required: true },
        responses: { "201": jsonResponse("Secret reference created.", { $ref: "#/components/schemas/SecretReference" }), "400": { $ref: "#/components/responses/Problem" }, "401": { $ref: "#/components/responses/Problem" }, "409": { $ref: "#/components/responses/Problem" } },
        summary: "Create a secret reference",
        tags: ["Targets"],
      },
    },
    "/v1/secret-references/{secretReferenceId}": {
      delete: {
        operationId: "deleteSecretReference",
        parameters: [...mutationOperationParameters, { $ref: "#/components/parameters/SecretReferencePathId" }],
        responses: { "204": { description: "Secret reference deleted.", headers: { "X-Request-Id": requestIdHeader } }, "401": { $ref: "#/components/responses/Problem" }, "403": { $ref: "#/components/responses/Problem" }, "404": { $ref: "#/components/responses/Problem" } },
        summary: "Delete a secret reference",
        tags: ["Targets"],
      },
      patch: {
        operationId: "rotateSecretReference",
        parameters: [...mutationOperationParameters, { $ref: "#/components/parameters/SecretReferencePathId" }],
        requestBody: { content: { "application/json": { schema: { additionalProperties: false, properties: { locatorHash: { pattern: "^[0-9a-f]{64}$", type: "string" }, providerVersion: { type: "string" } }, required: ["locatorHash"], type: "object" } } }, required: true },
        responses: { "200": jsonResponse("Secret reference rotated.", { $ref: "#/components/schemas/SecretReference" }), "400": { $ref: "#/components/responses/Problem" }, "401": { $ref: "#/components/responses/Problem" }, "404": { $ref: "#/components/responses/Problem" } },
        summary: "Rotate a secret reference",
        tags: ["Targets"],
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
    {
      description: "Tenant project lifecycle and repository metadata.",
      name: "Projects",
    },
    {
      description: "Verified endpoints, Stellar networks, assets, and corridors.",
      name: "Targets",
    },
  ],
} as const;
