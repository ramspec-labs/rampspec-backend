import { z } from "zod";

export const applicationNames = [
  "api",
  "browser",
  "cli",
  "evidence",
  "gateway",
  "report",
  "scheduler",
  "webhook",
  "workflow",
] as const;

export type ApplicationName = (typeof applicationNames)[number];

const knownPassphrases = Object.freeze({
  futurenet: "Test SDF Future Network ; October 2022",
  pubnet: "Public Global Stellar Network ; September 2015",
  testnet: "Test SDF Network ; September 2015",
} as const);

const secretReference = z
  .string()
  .regex(/^(?:aws-kms|azure-kv|gcp-kms|local|vault):\/\/[\w./:@-]+$/u);
const httpUrl = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
}, "Expected an HTTP or HTTPS URL.");

const configSchema = z.object({
  APP_ENV: z.enum(["development", "test", "staging", "production"]),
  APP_NAME: z.enum(applicationNames),
  APP_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  CONTROL_PLANE_URL: httpUrl.optional(),
  DATABASE_URL: z.string().startsWith("postgresql://").optional(),
  EVIDENCE_BUCKET: z.string().min(3).max(63).optional(),
  GITHUB_APP_ID: z.string().regex(/^\d+$/u).optional(),
  GITHUB_PRIVATE_KEY_REF: secretReference.optional(),
  KMS_KEY_ID: z.string().min(1).optional(),
  KMS_PROVIDER: z.enum(["aws", "azure", "gcp", "local", "vault"]).optional(),
  OBJECT_STORAGE_BUCKET: z.string().min(3).max(63).optional(),
  OBJECT_STORAGE_ENDPOINT: httpUrl.optional(),
  OIDC_CLIENT_ID: z.string().min(1).optional(),
  OIDC_CLIENT_SECRET_REF: secretReference.optional(),
  OIDC_ISSUER: z.url().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: httpUrl.optional(),
  REDIS_URL: z
    .string()
    .regex(/^rediss?:\/\//u, "Expected a Redis URL.")
    .optional(),
  RUNNER_CONTROL_PLANE_URL: httpUrl.optional(),
  RUNNER_MODE: z.enum(["local", "public"]).optional(),
  STELLAR_CUSTOM_NETWORK_ID: z.string().min(3).optional(),
  STELLAR_HORIZON_URL: httpUrl.optional(),
  STELLAR_NETWORK: z
    .enum(["custom", "futurenet", "pubnet", "testnet"])
    .optional(),
  STELLAR_NETWORK_PASSPHRASE: z.string().min(1).optional(),
  STELLAR_RPC_URL: httpUrl.optional(),
  TEMPORAL_ADDRESS: z
    .string()
    .regex(/^[\w.-]+:\d{1,5}$/u, "Expected a Temporal host and port.")
    .optional(),
  TEMPORAL_NAMESPACE: z.string().min(1).optional(),
});

type RuntimeConfig = z.infer<typeof configSchema>;

const requiredByApplication: Readonly<
  Record<ApplicationName, readonly (keyof RuntimeConfig)[]>
> = {
  api: [
    "APP_PORT",
    "DATABASE_URL",
    "EVIDENCE_BUCKET",
    "GITHUB_APP_ID",
    "GITHUB_PRIVATE_KEY_REF",
    "KMS_KEY_ID",
    "KMS_PROVIDER",
    "OBJECT_STORAGE_BUCKET",
    "OBJECT_STORAGE_ENDPOINT",
    "OIDC_CLIENT_ID",
    "OIDC_CLIENT_SECRET_REF",
    "OIDC_ISSUER",
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "REDIS_URL",
    "STELLAR_HORIZON_URL",
    "STELLAR_NETWORK",
    "STELLAR_NETWORK_PASSPHRASE",
    "STELLAR_RPC_URL",
  ],
  browser: [
    "EVIDENCE_BUCKET",
    "KMS_KEY_ID",
    "KMS_PROVIDER",
    "OBJECT_STORAGE_BUCKET",
    "OBJECT_STORAGE_ENDPOINT",
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "RUNNER_CONTROL_PLANE_URL",
    "RUNNER_MODE",
  ],
  cli: ["CONTROL_PLANE_URL"],
  evidence: [
    "EVIDENCE_BUCKET",
    "KMS_KEY_ID",
    "KMS_PROVIDER",
    "OBJECT_STORAGE_BUCKET",
    "OBJECT_STORAGE_ENDPOINT",
    "OTEL_EXPORTER_OTLP_ENDPOINT",
  ],
  gateway: [
    "APP_PORT",
    "OIDC_CLIENT_ID",
    "OIDC_CLIENT_SECRET_REF",
    "OIDC_ISSUER",
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "REDIS_URL",
  ],
  report: [
    "DATABASE_URL",
    "EVIDENCE_BUCKET",
    "KMS_KEY_ID",
    "KMS_PROVIDER",
    "OBJECT_STORAGE_BUCKET",
    "OBJECT_STORAGE_ENDPOINT",
    "OTEL_EXPORTER_OTLP_ENDPOINT",
  ],
  scheduler: [
    "DATABASE_URL",
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "REDIS_URL",
    "TEMPORAL_ADDRESS",
    "TEMPORAL_NAMESPACE",
  ],
  webhook: [
    "APP_PORT",
    "DATABASE_URL",
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "REDIS_URL",
    "TEMPORAL_ADDRESS",
    "TEMPORAL_NAMESPACE",
  ],
  workflow: [
    "DATABASE_URL",
    "EVIDENCE_BUCKET",
    "KMS_KEY_ID",
    "KMS_PROVIDER",
    "OBJECT_STORAGE_BUCKET",
    "OBJECT_STORAGE_ENDPOINT",
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "STELLAR_HORIZON_URL",
    "STELLAR_NETWORK",
    "STELLAR_NETWORK_PASSPHRASE",
    "STELLAR_RPC_URL",
    "TEMPORAL_ADDRESS",
    "TEMPORAL_NAMESPACE",
  ],
};

const managedPrefixes = [
  "APP_",
  "CONTROL_PLANE_",
  "DATABASE_",
  "EVIDENCE_",
  "GITHUB_",
  "KMS_",
  "OBJECT_STORAGE_",
  "OIDC_",
  "OTEL_",
  "REDIS_",
  "RUNNER_",
  "STELLAR_",
  "TEMPORAL_",
] as const;

const prohibitedSecretKeys = new Set([
  "DATABASE_PASSWORD",
  "GITHUB_PRIVATE_KEY",
  "GITHUB_TOKEN",
  "OBJECT_STORAGE_SECRET_KEY",
  "OIDC_CLIENT_SECRET",
  "RUNNER_TOKEN",
]);

function validateManagedKeys(environment: NodeJS.ProcessEnv): void {
  const recognized = new Set(Object.keys(configSchema.shape));
  for (const key of Object.keys(environment)) {
    if (prohibitedSecretKeys.has(key)) {
      throw new Error(
        `${key} is prohibited; configure a secret reference instead.`,
      );
    }
    if (
      managedPrefixes.some((prefix) => key.startsWith(prefix)) &&
      !recognized.has(key)
    ) {
      throw new Error(`Unknown RampSpec configuration key ${key}.`);
    }
  }
}

function requireApplicationFields(
  config: RuntimeConfig,
  application: ApplicationName,
): void {
  const missing = requiredByApplication[application].filter(
    (key) => config[key] === undefined,
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing ${application} configuration: ${missing.join(", ")}.`,
    );
  }
}

function validateNetwork(config: RuntimeConfig): void {
  if (!config.STELLAR_NETWORK) return;
  if (!config.STELLAR_NETWORK_PASSPHRASE) {
    throw new Error(
      "STELLAR_NETWORK_PASSPHRASE is required when a network is configured.",
    );
  }

  if (config.STELLAR_NETWORK === "custom") {
    if (!config.STELLAR_CUSTOM_NETWORK_ID) {
      throw new Error(
        "STELLAR_CUSTOM_NETWORK_ID is required for a custom network.",
      );
    }
    if (
      Object.values(knownPassphrases).includes(
        config.STELLAR_NETWORK_PASSPHRASE as never,
      )
    ) {
      throw new Error(
        "A known network passphrase cannot be configured as a custom network.",
      );
    }
    return;
  }

  if (
    config.STELLAR_NETWORK_PASSPHRASE !==
    knownPassphrases[config.STELLAR_NETWORK]
  ) {
    throw new Error(
      `Network passphrase does not match ${config.STELLAR_NETWORK}.`,
    );
  }
}

function validateProduction(config: RuntimeConfig): void {
  if (config.APP_ENV !== "production") return;
  if (config.KMS_PROVIDER === "local") {
    throw new Error("The local KMS provider is prohibited in production.");
  }

  const urlKeys = [
    "CONTROL_PLANE_URL",
    "OBJECT_STORAGE_ENDPOINT",
    "OIDC_ISSUER",
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "RUNNER_CONTROL_PLANE_URL",
    "STELLAR_HORIZON_URL",
    "STELLAR_RPC_URL",
  ] as const;
  for (const key of urlKeys) {
    const value = config[key];
    if (value && new URL(value).protocol !== "https:") {
      throw new Error(`${key} must use HTTPS in production.`);
    }
  }
}

export function loadConfig(
  application: ApplicationName,
  environment: NodeJS.ProcessEnv = process.env,
): Readonly<RuntimeConfig> {
  validateManagedKeys(environment);
  const selected = Object.fromEntries(
    Object.keys(configSchema.shape).map((key) => [key, environment[key]]),
  );
  const config = configSchema.parse(selected);

  if (config.APP_NAME !== application) {
    throw new Error(
      `APP_NAME ${config.APP_NAME} does not match ${application}.`,
    );
  }
  requireApplicationFields(config, application);
  validateNetwork(config);
  validateProduction(config);
  return Object.freeze(config);
}

export { knownPassphrases };
