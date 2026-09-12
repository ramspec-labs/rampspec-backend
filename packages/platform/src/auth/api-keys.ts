import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

import { createId, toUtcTimestamp } from "../../../domain/src/index.js";

const scrypt = promisify(scryptCallback);
const keyPattern = /^rsk_[A-Za-z0-9_-]{43}$/u;

export interface ApiKeyRecord {
  readonly createdAt: string;
  readonly disabledAt?: string;
  readonly expiresAt?: string;
  readonly id: string;
  readonly keyHash: string;
  readonly keyPrefix: string;
  readonly lastUsedAt?: string;
  readonly organizationId: string;
  readonly scopes: readonly string[];
  readonly serviceAccountId: string;
}

export interface ApiKeyStore {
  insert(record: ApiKeyRecord): Promise<void>;
  findByPrefix(prefix: string): Promise<ApiKeyRecord | undefined>;
  update(record: ApiKeyRecord): Promise<void>;
  listActive(serviceAccountId: string): Promise<readonly ApiKeyRecord[]>;
}

export interface ApiKeyCredentials {
  readonly apiKeyId: string;
  readonly key: string;
  readonly prefix: string;
  readonly scopes: readonly string[];
}

export interface ApiKeyServiceOptions {
  readonly clock?: () => Date;
  readonly maxActivePerServiceAccount?: number;
  readonly store: ApiKeyStore;
}

function validateScopes(scopes: readonly string[]): readonly string[] {
  const normalized = [...new Set(scopes.map((scope) => scope.trim()))].sort();
  if (
    normalized.length === 0 ||
    normalized.length > 64 ||
    normalized.some(
      (scope) =>
        !/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*(?::[a-z0-9-]+)?$/u.test(scope),
    )
  ) {
    throw new TypeError(
      "API key scopes must be non-empty resource:action values.",
    );
  }
  return normalized;
}

async function hashKey(key: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(key, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

async function verifyHash(key: string, encoded: string): Promise<boolean> {
  const [algorithm, saltText, derivedText] = encoded.split("$");
  if (algorithm !== "scrypt" || !saltText || !derivedText) return false;
  const salt = Buffer.from(saltText, "base64url");
  const expected = Buffer.from(derivedText, "base64url");
  const actual = (await scrypt(key, salt, expected.length)) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export class ApiKeyService {
  private readonly clock: () => Date;
  private readonly maxActive: number;
  private readonly store: ApiKeyStore;

  constructor(options: ApiKeyServiceOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.maxActive = options.maxActivePerServiceAccount ?? 20;
    if (!Number.isInteger(this.maxActive) || this.maxActive < 1) {
      throw new RangeError("Maximum active API keys must be positive.");
    }
    this.store = options.store;
  }

  private async issueInternal(
    organizationId: string,
    serviceAccountId: string,
    scopes: readonly string[],
    expiresAt?: Date,
    replacingKeyId?: string,
  ): Promise<ApiKeyCredentials> {
    const active = await this.store.listActive(serviceAccountId);
    if (
      active.filter(({ id }) => id !== replacingKeyId).length >= this.maxActive
    ) {
      throw new Error("API key rate limit reached for service account.");
    }
    const now = this.clock();
    if (expiresAt && expiresAt <= now)
      throw new RangeError("API key expiry must be in the future.");
    const normalizedScopes = validateScopes(scopes);
    const key = `rsk_${randomBytes(32).toString("base64url")}`;
    const record: ApiKeyRecord = {
      createdAt: toUtcTimestamp(now),
      ...(expiresAt ? { expiresAt: toUtcTimestamp(expiresAt) } : {}),
      id: createId("api_key"),
      keyHash: await hashKey(key),
      keyPrefix: key.slice(0, 16),
      organizationId,
      scopes: normalizedScopes,
      serviceAccountId,
    };
    await this.store.insert(record);
    return {
      apiKeyId: record.id,
      key,
      prefix: record.keyPrefix,
      scopes: record.scopes,
    };
  }

  async issue(
    organizationId: string,
    serviceAccountId: string,
    scopes: readonly string[],
    expiresAt?: Date,
  ): Promise<ApiKeyCredentials> {
    return this.issueInternal(
      organizationId,
      serviceAccountId,
      scopes,
      expiresAt,
    );
  }

  async authenticate(
    key: string,
    requiredScope?: string,
  ): Promise<ApiKeyRecord> {
    if (!keyPattern.test(key)) throw new Error("Invalid API key.");
    const record = await this.store.findByPrefix(key.slice(0, 16));
    const now = this.clock();
    if (
      !record ||
      record.disabledAt ||
      (record.expiresAt && new Date(record.expiresAt) <= now) ||
      !(await verifyHash(key, record.keyHash))
    ) {
      throw new Error("Invalid or expired API key.");
    }
    if (
      requiredScope &&
      !record.scopes.includes(requiredScope) &&
      !record.scopes.includes("*")
    ) {
      throw new Error("API key scope is not granted.");
    }
    const updated = { ...record, lastUsedAt: toUtcTimestamp(now) };
    await this.store.update(updated);
    return updated;
  }

  async disable(apiKeyId: string): Promise<void> {
    const now = toUtcTimestamp(this.clock());
    const all = await this.store.listActive("");
    const record = all.find(({ id }) => id === apiKeyId);
    if (!record) throw new Error("API key not found or already disabled.");
    await this.store.update({ ...record, disabledAt: now });
  }

  async rotate(
    organizationId: string,
    serviceAccountId: string,
    oldKey: string,
    expiresAt?: Date,
  ): Promise<ApiKeyCredentials> {
    const current = await this.authenticate(oldKey);
    if (
      current.organizationId !== organizationId ||
      current.serviceAccountId !== serviceAccountId
    ) {
      throw new Error("API key ownership mismatch.");
    }
    const next = await this.issueInternal(
      organizationId,
      serviceAccountId,
      current.scopes,
      expiresAt,
      current.id,
    );
    await this.store.update({
      ...current,
      disabledAt: toUtcTimestamp(this.clock()),
    });
    return next;
  }
}

export class InMemoryApiKeyStore implements ApiKeyStore {
  private readonly records = new Map<string, ApiKeyRecord>();

  insert(record: ApiKeyRecord): Promise<void> {
    if (
      [...this.records.values()].some(
        ({ keyPrefix }) => keyPrefix === record.keyPrefix,
      )
    ) {
      return Promise.reject(new Error("Duplicate API key prefix."));
    }
    this.records.set(record.id, Object.freeze(record));
    return Promise.resolve();
  }

  findByPrefix(prefix: string): Promise<ApiKeyRecord | undefined> {
    return Promise.resolve(
      [...this.records.values()].find(
        ({ keyPrefix, disabledAt }) => keyPrefix === prefix && !disabledAt,
      ),
    );
  }

  update(record: ApiKeyRecord): Promise<void> {
    if (!this.records.has(record.id))
      return Promise.reject(new Error("API key not found."));
    this.records.set(record.id, Object.freeze(record));
    return Promise.resolve();
  }

  listActive(serviceAccountId: string): Promise<readonly ApiKeyRecord[]> {
    return Promise.resolve(
      [...this.records.values()].filter(
        ({ serviceAccountId: candidate, disabledAt }) =>
          (!serviceAccountId || candidate === serviceAccountId) && !disabledAt,
      ),
    );
  }
}
