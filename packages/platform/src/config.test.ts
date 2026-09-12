import { describe, expect, it } from "vitest";

import { applicationNames, knownPassphrases, loadConfig } from "./config.js";

function validEnvironment(
  application: (typeof applicationNames)[number],
): NodeJS.ProcessEnv {
  return {
    APP_ENV: "test",
    APP_NAME: application,
    APP_PORT: "3000",
    CONTROL_PLANE_URL: "https://control.example.test",
    DATABASE_URL: "postgresql://rampspec@database.example.test/rampspec",
    EVIDENCE_BUCKET: "rampspec-evidence",
    GITHUB_APP_ID: "12345",
    GITHUB_PRIVATE_KEY_REF: "vault://github/private-key",
    KMS_KEY_ID: "rampspec-test-key",
    KMS_PROVIDER: "vault",
    OBJECT_STORAGE_BUCKET: "rampspec-artifacts",
    OBJECT_STORAGE_ENDPOINT: "https://objects.example.test",
    OIDC_CLIENT_ID: "rampspec-test",
    OIDC_CLIENT_SECRET_REF: "vault://oidc/client-secret",
    OIDC_ISSUER: "https://identity.example.test",
    OTEL_EXPORTER_OTLP_ENDPOINT: "https://telemetry.example.test",
    REDIS_URL: "rediss://redis.example.test:6379",
    RUNNER_CONTROL_PLANE_URL: "https://control.example.test",
    RUNNER_MODE: "local",
    STELLAR_HORIZON_URL: "https://horizon-testnet.stellar.org",
    STELLAR_NETWORK: "testnet",
    STELLAR_NETWORK_PASSPHRASE: knownPassphrases.testnet,
    STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
    TEMPORAL_ADDRESS: "temporal.example.test:7233",
    TEMPORAL_NAMESPACE: "rampspec-test",
  };
}

describe("application configuration", () => {
  it.each(applicationNames)("loads the %s profile", (application) => {
    const config = loadConfig(application, validEnvironment(application));
    expect(config.APP_NAME).toBe(application);
  });

  const representativeRequiredKey = {
    api: "GITHUB_APP_ID",
    browser: "RUNNER_MODE",
    cli: "CONTROL_PLANE_URL",
    evidence: "EVIDENCE_BUCKET",
    gateway: "OIDC_ISSUER",
    report: "OBJECT_STORAGE_BUCKET",
    scheduler: "REDIS_URL",
    webhook: "APP_PORT",
    workflow: "TEMPORAL_NAMESPACE",
  } as const;

  it.each(applicationNames)(
    "reports missing %s configuration",
    (application) => {
      const environment = validEnvironment(application);
      const key = representativeRequiredKey[application];
      delete environment[key];
      expect(() => loadConfig(application, environment)).toThrow(key);
    },
  );

  it("rejects an app-name conflict", () => {
    const environment = validEnvironment("api");
    environment.APP_NAME = "cli";
    expect(() => loadConfig("api", environment)).toThrow("does not match api");
  });

  it("rejects a passphrase for the wrong network", () => {
    const environment = validEnvironment("workflow");
    environment.STELLAR_NETWORK = "pubnet";
    expect(() => loadConfig("workflow", environment)).toThrow(
      "does not match pubnet",
    );
  });

  it("allows an explicitly named custom network only with an unknown passphrase", () => {
    const environment = validEnvironment("workflow");
    environment.STELLAR_NETWORK = "custom";
    environment.STELLAR_NETWORK_PASSPHRASE = "RampSpec Isolated Network ; 2026";
    environment.STELLAR_CUSTOM_NETWORK_ID = "rampspec-isolated";
    expect(loadConfig("workflow", environment).STELLAR_NETWORK).toBe("custom");
  });

  it("rejects raw secret values and unknown managed keys", () => {
    expect(() =>
      loadConfig("api", {
        ...validEnvironment("api"),
        OIDC_CLIENT_SECRET: "secret",
      }),
    ).toThrow("secret reference");
    expect(() =>
      loadConfig("api", {
        ...validEnvironment("api"),
        STELLAR_NETWROK: "testnet",
      }),
    ).toThrow("Unknown RampSpec configuration key");
  });

  it("requires HTTPS and external key management in production", () => {
    const environment = validEnvironment("api");
    environment.APP_ENV = "production";
    environment.KMS_PROVIDER = "local";
    expect(() => loadConfig("api", environment)).toThrow("local KMS");

    environment.KMS_PROVIDER = "vault";
    environment.OBJECT_STORAGE_ENDPOINT = "http://objects.example.test";
    expect(() => loadConfig("api", environment)).toThrow("must use HTTPS");
  });
});
