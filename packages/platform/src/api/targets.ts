import {
  assertNetworkPassphrase,
  createId,
  knownNetworkPassphrases,
  normalizeOrigin,
  parseId,
  type OpaqueId,
} from "../../../domain/src/index.js";

export type StellarNetwork = "custom" | "futurenet" | "pubnet" | "testnet";
export interface Target {
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly customNetworkId: string | null;
  readonly expectedMethods: readonly string[];
  readonly expectedSeps: readonly string[];
  readonly id: OpaqueId<"target">;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly name: string;
  readonly networkPassphrase: string;
  readonly normalizedOrigin: string;
  readonly organizationId: OpaqueId<"organization">;
  readonly projectId: OpaqueId<"project">;
  readonly runnerPolicy: Readonly<Record<string, unknown>>;
  readonly status: "archived" | "pending_verification" | "suspended" | "verified";
  readonly stellarNetwork: StellarNetwork;
  readonly updatedAt: string;
  readonly verifiedUntil: string | null;
}

export interface Asset {
  readonly canonicalAssetId: string;
  readonly code: string | null;
  readonly contractId: string | null;
  readonly createdAt: string;
  readonly decimals: number;
  readonly enabled: boolean;
  readonly id: OpaqueId<"asset">;
  readonly issuer: string | null;
  readonly organizationId: OpaqueId<"organization">;
  readonly targetId: OpaqueId<"target">;
  readonly type: "contract" | "credit_alphanum12" | "credit_alphanum4" | "native";
}

export interface Corridor {
  readonly createdAt: string;
  readonly direction: "deposit" | "receive" | "send" | "withdrawal";
  readonly enabled: boolean;
  readonly id: OpaqueId<"corridor">;
  readonly inputAssetId: OpaqueId<"asset">;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly methods: readonly string[];
  readonly organizationId: OpaqueId<"organization">;
  readonly outputAssetId: OpaqueId<"asset">;
  readonly targetId: OpaqueId<"target">;
}

export interface TargetRepository {
  list(organizationId: OpaqueId<"organization">): Promise<readonly Target[]>;
  get(organizationId: OpaqueId<"organization">, id: OpaqueId<"target">): Promise<Target | undefined>;
  insert(target: Target): Promise<void>;
  update(target: Target): Promise<void>;
  insertAsset(asset: Asset): Promise<void>;
  getAsset(organizationId: OpaqueId<"organization">, id: OpaqueId<"asset">): Promise<Asset | undefined>;
  insertCorridor(corridor: Corridor): Promise<void>;
  getCorridor(organizationId: OpaqueId<"organization">, id: OpaqueId<"corridor">): Promise<Corridor | undefined>;
  listCorridors(organizationId: OpaqueId<"organization">, targetId: OpaqueId<"target">): Promise<readonly Corridor[]>;
  updateCorridor(corridor: Corridor): Promise<void>;
}

export interface TargetAudit { record(input: { readonly action: string; readonly organizationId: string; readonly targetId: string; readonly targetType: string }): Promise<void>; }

function boundedList(values: readonly string[] | undefined, maximum: number, label: string): readonly string[] {
  const result = values ?? [];
  if (result.length > maximum || result.some((value) => !value.trim())) throw new Error(`Invalid ${label}.`);
  return Object.freeze([...new Set(result.map((value) => value.trim()))]);
}

function jsonObject(value: Readonly<Record<string, unknown>> | undefined, maximum: number, label: string): Readonly<Record<string, unknown>> {
  const copy = structuredClone(value ?? {});
  if (JSON.stringify(copy).length > maximum) throw new Error(`${label} is too large.`);
  return Object.freeze(copy);
}

function network(input: { readonly stellarNetwork: StellarNetwork; readonly networkPassphrase: string; readonly customNetworkId?: string | null }): { readonly customNetworkId: string | null; readonly networkPassphrase: string } {
  if (input.stellarNetwork === "custom") {
    if (!input.customNetworkId || input.customNetworkId.trim().length < 3 || Object.values(knownNetworkPassphrases).includes(input.networkPassphrase as never)) throw new Error("Invalid custom network.");
    return { customNetworkId: input.customNetworkId.trim(), networkPassphrase: input.networkPassphrase };
  }
  return { customNetworkId: null, networkPassphrase: assertNetworkPassphrase(input.stellarNetwork, input.networkPassphrase) };
}

export class TargetService {
  private readonly audit: TargetAudit | undefined;
  private readonly clock: () => Date;
  private readonly repository: TargetRepository;
  constructor(options: { readonly audit?: TargetAudit; readonly clock?: () => Date; readonly repository: TargetRepository }) {
    this.audit = options.audit;
    this.clock = options.clock ?? (() => new Date());
    this.repository = options.repository;
  }

  async list(organizationId: string): Promise<readonly Target[]> { return this.repository.list(parseId("organization", organizationId)); }

  async create(input: { readonly organizationId: string; readonly projectId: string; readonly name: string; readonly origin: string; readonly stellarNetwork: StellarNetwork; readonly networkPassphrase: string; readonly customNetworkId?: string | null; readonly expectedSeps?: readonly string[]; readonly expectedMethods?: readonly string[]; readonly runnerPolicy?: Readonly<Record<string, unknown>>; readonly metadata?: Readonly<Record<string, unknown>> }): Promise<Target> {
    const organizationId = parseId("organization", input.organizationId);
    const now = this.clock().toISOString();
    const resolvedNetwork = network(input);
    const target: Target = Object.freeze({
      archivedAt: null,
      createdAt: now,
      customNetworkId: resolvedNetwork.customNetworkId,
      expectedMethods: boundedList(input.expectedMethods, 64, "expected methods"),
      expectedSeps: boundedList(input.expectedSeps, 128, "expected SEP list"),
      id: createId("target"),
      metadata: jsonObject(input.metadata, 16384, "Target metadata"),
      name: input.name.trim(),
      networkPassphrase: resolvedNetwork.networkPassphrase,
      normalizedOrigin: normalizeOrigin(input.origin),
      organizationId,
      projectId: parseId("project", input.projectId),
      runnerPolicy: jsonObject(input.runnerPolicy, 32768, "Runner policy"),
      status: "pending_verification",
      stellarNetwork: input.stellarNetwork,
      updatedAt: now,
      verifiedUntil: null,
    });
    if (!target.name || target.name.length > 200) throw new Error("Invalid target name.");
    await this.repository.insert(target);
    await this.audit?.record({ action: "target.created", organizationId, targetId: target.id, targetType: "target" });
    return target;
  }

  async get(organizationId: string, id: string): Promise<Target> {
    const target = await this.repository.get(parseId("organization", organizationId), parseId("target", id));
    if (!target) throw new Error("Target not found.");
    return target;
  }

  async archive(organizationId: string, id: string): Promise<Target> {
    const target = await this.get(organizationId, id);
    if (target.status === "archived") return target;
    const at = this.clock().toISOString();
    const archived = Object.freeze({ ...target, archivedAt: at, status: "archived" as const, updatedAt: at });
    await this.repository.update(archived);
    await this.audit?.record({ action: "target.archived", organizationId: target.organizationId, targetId: target.id, targetType: "target" });
    return archived;
  }

  async createCorridor(input: { readonly organizationId: string; readonly targetId: string; readonly inputAssetId: string; readonly outputAssetId: string; readonly direction: Corridor["direction"]; readonly methods: readonly string[]; readonly metadata?: Readonly<Record<string, unknown>> }): Promise<Corridor> {
    if (input.inputAssetId === input.outputAssetId) throw new Error("Corridor assets must differ.");
    const organizationId = parseId("organization", input.organizationId);
    const targetId = parseId("target", input.targetId);
    const inputAssetId = parseId("asset", input.inputAssetId);
    const outputAssetId = parseId("asset", input.outputAssetId);
    const inputAsset = await this.repository.getAsset(organizationId, inputAssetId);
    const outputAsset = await this.repository.getAsset(organizationId, outputAssetId);
    if (!inputAsset || !outputAsset || inputAsset.targetId !== targetId || outputAsset.targetId !== targetId) throw new Error("Corridor asset not found.");
    const corridor: Corridor = Object.freeze({ createdAt: this.clock().toISOString(), direction: input.direction, enabled: true, id: createId("corridor"), inputAssetId, metadata: jsonObject(input.metadata, 16384, "Corridor metadata"), methods: boundedList(input.methods, 64, "corridor methods"), organizationId, outputAssetId, targetId });
    if (!corridor.methods.length) throw new Error("Corridor methods are required.");
    await this.repository.insertCorridor(corridor);
    await this.audit?.record({ action: "corridor.created", organizationId, targetId: corridor.id, targetType: "corridor" });
    return corridor;
  }

  async listCorridors(organizationId: string, targetId: string): Promise<readonly Corridor[]> { return this.repository.listCorridors(parseId("organization", organizationId), parseId("target", targetId)); }

  async setCorridorEnabled(organizationId: string, id: string, enabled: boolean): Promise<Corridor> {
    const organization = parseId("organization", organizationId);
    const corridor = await this.repository.getCorridor(organization, parseId("corridor", id));
    if (!corridor) throw new Error("Corridor not found.");
    if (corridor.enabled === enabled) return corridor;
    const updated = Object.freeze({ ...corridor, enabled });
    await this.repository.updateCorridor(updated);
    await this.audit?.record({ action: enabled ? "corridor.enabled" : "corridor.disabled", organizationId: organization, targetId: corridor.id, targetType: "corridor" });
    return updated;
  }
}

export class InMemoryTargetRepository implements TargetRepository {
  private readonly assets = new Map<string, Asset>();
  private readonly corridors = new Map<string, Corridor>();
  private readonly targets = new Map<string, Target>();
  list(organizationId: OpaqueId<"organization">): Promise<readonly Target[]> { return Promise.resolve([...this.targets.values()].filter((target) => target.organizationId === organizationId)); }
  get(organizationId: OpaqueId<"organization">, id: OpaqueId<"target">): Promise<Target | undefined> { const target = this.targets.get(id); return Promise.resolve(target?.organizationId === organizationId ? target : undefined); }
  insert(target: Target): Promise<void> { if ([...this.targets.values()].some((candidate) => candidate.organizationId === target.organizationId && candidate.normalizedOrigin === target.normalizedOrigin)) return Promise.reject(new Error("Target origin already exists.")); this.targets.set(target.id, target); return Promise.resolve(); }
  update(target: Target): Promise<void> { this.targets.set(target.id, target); return Promise.resolve(); }
  insertAsset(asset: Asset): Promise<void> { this.assets.set(asset.id, asset); return Promise.resolve(); }
  getAsset(organizationId: OpaqueId<"organization">, id: OpaqueId<"asset">): Promise<Asset | undefined> { const asset = this.assets.get(id); return Promise.resolve(asset?.organizationId === organizationId ? asset : undefined); }
  insertCorridor(corridor: Corridor): Promise<void> { if ([...this.corridors.values()].some((candidate) => candidate.organizationId === corridor.organizationId && candidate.targetId === corridor.targetId && candidate.inputAssetId === corridor.inputAssetId && candidate.outputAssetId === corridor.outputAssetId && candidate.direction === corridor.direction)) return Promise.reject(new Error("Corridor already exists.")); this.corridors.set(corridor.id, corridor); return Promise.resolve(); }
  getCorridor(organizationId: OpaqueId<"organization">, id: OpaqueId<"corridor">): Promise<Corridor | undefined> { const corridor = this.corridors.get(id); return Promise.resolve(corridor?.organizationId === organizationId ? corridor : undefined); }
  listCorridors(organizationId: OpaqueId<"organization">, targetId: OpaqueId<"target">): Promise<readonly Corridor[]> { return Promise.resolve([...this.corridors.values()].filter((corridor) => corridor.organizationId === organizationId && corridor.targetId === targetId)); }
  updateCorridor(corridor: Corridor): Promise<void> { this.corridors.set(corridor.id, corridor); return Promise.resolve(); }
}
