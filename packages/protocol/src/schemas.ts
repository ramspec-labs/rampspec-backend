const schemaBase = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  schemaVersion: {
    const: "1.0.0",
    description: "Version of this individual contract.",
    type: "string",
  },
} as const;

const extensions = {
  additionalProperties: true,
  description: "Namespaced forward-compatible extension values.",
  propertyNames: { pattern: "^[a-z][a-z0-9-]*\\.[a-z][a-z0-9.-]*$" },
  type: "object",
} as const;

const utcTimestamp = {
  format: "date-time",
  pattern:
    "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$",
  type: "string",
} as const;

const opaqueId = (kind: string) => ({
  pattern: `^${kind}_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
  type: "string",
});

export const ruleSchema = {
  $id: "https://schemas.rampspec.dev/backend/v1/rule.schema.json",
  $schema: schemaBase.$schema,
  additionalProperties: false,
  properties: {
    assertion: { minLength: 3, pattern: "^[a-z][a-z0-9.-]+$", type: "string" },
    classification: {
      enum: ["normative", "recommended", "informational", "draft"],
      type: "string",
    },
    extensions,
    id: { minLength: 3, pattern: "^[a-z][a-z0-9.-]+$", type: "string" },
    schemaVersion: schemaBase.schemaVersion,
    sep: { pattern: "^SEP-[0-9]{4}$", type: "string" },
    severity: {
      enum: ["info", "warning", "error", "critical"],
      type: "string",
    },
    source: {
      additionalProperties: false,
      properties: {
        commit: { pattern: "^[0-9a-f]{40}$", type: "string" },
        line: { minimum: 1, type: "integer" },
        uri: { format: "uri", type: "string" },
      },
      required: ["uri", "commit", "line"],
      type: "object",
    },
  },
  required: [
    "schemaVersion",
    "id",
    "sep",
    "classification",
    "severity",
    "source",
    "assertion",
  ],
  title: "RampSpec Rule",
  type: "object",
} as const;

export const scenarioSchema = {
  $id: "https://schemas.rampspec.dev/backend/v1/scenario.schema.json",
  $schema: schemaBase.$schema,
  additionalProperties: false,
  properties: {
    extensions,
    id: { minLength: 3, pattern: "^scenario\\.[a-z0-9.-]+$", type: "string" },
    parameters: { additionalProperties: true, type: "object" },
    safety: {
      additionalProperties: false,
      properties: {
        allowPubnet: { type: "boolean" },
        mutatesState: { type: "boolean" },
        requiresSecrets: { type: "boolean" },
        timeoutSeconds: { maximum: 3600, minimum: 1, type: "integer" },
      },
      required: ["allowPubnet", "mutatesState", "requiresSecrets", "timeoutSeconds"],
      type: "object",
    },
    schemaVersion: schemaBase.schemaVersion,
    sep: { pattern: "^SEP-[0-9]{4}$", type: "string" },
    steps: {
      items: {
        additionalProperties: false,
        properties: {
          adapter: { pattern: "^[a-z][a-z0-9.-]+$", type: "string" },
          id: { pattern: "^[a-z][a-z0-9-]+$", type: "string" },
        },
        required: ["id", "adapter"],
        type: "object",
      },
      minItems: 1,
      type: "array",
    },
    version: { pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$", type: "string" },
  },
  required: ["schemaVersion", "id", "version", "sep", "parameters", "steps", "safety"],
  title: "RampSpec Scenario",
  type: "object",
} as const;

export const suiteLockSchema = {
  $id: "https://schemas.rampspec.dev/backend/v1/suite-lock.schema.json",
  $schema: schemaBase.$schema,
  additionalProperties: false,
  properties: {
    extensions,
    lockHash: { pattern: "^[0-9a-f]{64}$", type: "string" },
    rulePacks: {
      additionalProperties: {
        pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
        type: "string",
      },
      minProperties: 1,
      type: "object",
    },
    scenarios: {
      additionalProperties: {
        pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
        type: "string",
      },
      minProperties: 1,
      type: "object",
    },
    schemaVersion: schemaBase.schemaVersion,
    suiteId: opaqueId("suite"),
    suiteVersion: { pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$", type: "string" },
  },
  required: [
    "schemaVersion",
    "suiteId",
    "suiteVersion",
    "rulePacks",
    "scenarios",
    "lockHash",
  ],
  title: "RampSpec Suite Lock",
  type: "object",
} as const;

export const eventSchema = {
  $id: "https://schemas.rampspec.dev/backend/v1/event.schema.json",
  $schema: schemaBase.$schema,
  additionalProperties: false,
  properties: {
    eventId: opaqueId("event"),
    extensions,
    occurredAt: utcTimestamp,
    payload: { additionalProperties: true, type: "object" },
    runId: opaqueId("run"),
    schemaVersion: schemaBase.schemaVersion,
    sequence: { minimum: 0, type: "integer" },
    type: { pattern: "^[a-z][a-z0-9.]+$", type: "string" },
  },
  required: [
    "schemaVersion",
    "eventId",
    "runId",
    "sequence",
    "type",
    "occurredAt",
    "payload",
  ],
  title: "RampSpec Event",
  type: "object",
} as const;

export const reportSchema = {
  $id: "https://schemas.rampspec.dev/backend/v1/report.schema.json",
  $schema: schemaBase.$schema,
  additionalProperties: false,
  properties: {
    evidenceManifestHash: { pattern: "^[0-9a-f]{64}$", type: "string" },
    extensions,
    findingIds: {
      items: opaqueId("finding"),
      type: "array",
      uniqueItems: true,
    },
    generatedAt: utcTimestamp,
    reportId: opaqueId("report"),
    runId: opaqueId("run"),
    schemaVersion: schemaBase.schemaVersion,
    summary: {
      additionalProperties: false,
      properties: {
        failed: { minimum: 0, type: "integer" },
        passed: { minimum: 0, type: "integer" },
        skipped: { minimum: 0, type: "integer" },
        warnings: { minimum: 0, type: "integer" },
      },
      required: ["passed", "failed", "warnings", "skipped"],
      type: "object",
    },
  },
  required: [
    "schemaVersion",
    "reportId",
    "runId",
    "generatedAt",
    "summary",
    "findingIds",
    "evidenceManifestHash",
  ],
  title: "RampSpec Report",
  type: "object",
} as const;

export const schemaRegistry = [
  {
    fileName: "event.schema.json",
    typeName: "RampSpecEvent",
    schema: eventSchema,
  },
  {
    fileName: "report.schema.json",
    typeName: "RampSpecReport",
    schema: reportSchema,
  },
  {
    fileName: "rule.schema.json",
    typeName: "RampSpecRule",
    schema: ruleSchema,
  },
  {
    fileName: "scenario.schema.json",
    typeName: "RampSpecScenario",
    schema: scenarioSchema,
  },
  {
    fileName: "suite-lock.schema.json",
    typeName: "RampSpecSuiteLock",
    schema: suiteLockSchema,
  },
] as const;
