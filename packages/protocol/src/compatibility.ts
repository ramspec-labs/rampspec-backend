export interface CompatibilityReport {
  readonly breaking: boolean;
  readonly removedOperations: readonly string[];
  readonly addedOperations: readonly string[];
}

export interface SchemaChange {
  readonly path: string;
  readonly kind: "added_property" | "removed_property" | "type_changed" | "required_added" | "required_removed" | "constraint_changed";
  readonly breaking: boolean;
  readonly description: string;
}

export interface SchemaCompatibilityResult {
  readonly schemaName: string;
  readonly breaking: boolean;
  readonly changes: readonly SchemaChange[];
  readonly overrideEvidence?: string | undefined;
}

export interface SchemaCompatibilityGateResult {
  readonly passed: boolean;
  readonly breakingCount: number;
  readonly totalSchemas: number;
  readonly results: readonly SchemaCompatibilityResult[];
  readonly overrideEvidenceProvided: boolean;
}

function operations(
  document: Readonly<Record<string, unknown>>,
): Set<string> {
  const result = new Set<string>();
  const paths = document.paths as
    | Record<string, Record<string, { operationId?: string }>>
    | undefined;
  for (const [path, item] of Object.entries(paths ?? {}))
    for (const [method, operation] of Object.entries(item))
      if (operation?.operationId)
        result.add(`${method.toUpperCase()} ${path} ${operation.operationId}`);
  return result;
}

export function compareContracts(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): CompatibilityReport {
  const oldOps = operations(before);
  const newOps = operations(after);
  return {
    addedOperations: [...newOps]
      .filter((operation) => !oldOps.has(operation))
      .sort(),
    breaking: [...oldOps].some((operation) => !newOps.has(operation)),
    removedOperations: [...oldOps]
      .filter((operation) => !newOps.has(operation))
      .sort(),
  };
}

/**
 * Compare two JSON Schemas (baseline vs current) and classify additive vs breaking changes deterministically.
 */
export function compareJsonSchemas(
  schemaName: string,
  baseline: Readonly<Record<string, unknown>>,
  current: Readonly<Record<string, unknown>>,
  overrideEvidence?: string,
): SchemaCompatibilityResult {
  const changes: SchemaChange[] = [];

  const baselineProps = (baseline.properties ?? {}) as Record<string, Record<string, unknown>>;
  const currentProps = (current.properties ?? {}) as Record<string, Record<string, unknown>>;

  const baselineRequired = new Set(Array.isArray(baseline.required) ? baseline.required : []);
  const currentRequired = new Set(Array.isArray(current.required) ? current.required : []);

  // 1. Check for removed properties (Breaking)
  for (const propName of Object.keys(baselineProps)) {
    if (!(propName in currentProps)) {
      changes.push({
        breaking: true,
        description: `Property '${propName}' was removed.`,
        kind: "removed_property",
        path: `properties.${propName}`,
      });
    }
  }

  // 2. Check for added properties
  for (const propName of Object.keys(currentProps)) {
    if (!(propName in baselineProps)) {
      // Adding a required property is breaking. Adding an optional property is additive (non-breaking).
      const isRequired = currentRequired.has(propName);
      changes.push({
        breaking: isRequired,
        description: isRequired
          ? `Added new required property '${propName}'.`
          : `Added new optional property '${propName}'.`,
        kind: "added_property",
        path: `properties.${propName}`,
      });
    }
  }

  // 3. Check for type changes or modified shared properties
  for (const [propName, baseDef] of Object.entries(baselineProps)) {
    if (propName in currentProps) {
      const currDef = currentProps[propName]!;
      const baseType = typeof baseDef.type === "string" ? baseDef.type : undefined;
      const currType = typeof currDef.type === "string" ? currDef.type : undefined;
      if (baseType && currType && baseType !== currType) {
        changes.push({
          breaking: true,
          description: `Type of '${propName}' changed from '${baseType}' to '${currType}'.`,
          kind: "type_changed",
          path: `properties.${propName}.type`,
        });
      }
      const basePattern = typeof baseDef.pattern === "string" ? baseDef.pattern : undefined;
      const currPattern = typeof currDef.pattern === "string" ? currDef.pattern : undefined;
      if (basePattern && currPattern && basePattern !== currPattern) {
        changes.push({
          breaking: true,
          description: `Pattern of '${propName}' changed from '${basePattern}' to '${currPattern}'.`,
          kind: "constraint_changed",
          path: `properties.${propName}.pattern`,
        });
      }
    }
  }

  // 4. Check for existing properties that became newly required (Breaking)
  for (const req of currentRequired) {
    if (!baselineRequired.has(req) && req in baselineProps) {
      changes.push({
        breaking: true,
        description: `Existing property '${req}' was made required.`,
        kind: "required_added",
        path: `required.${req}`,
      });
    }
  }

  // 5. Check for properties that were required and became optional (Additive / Non-breaking)
  for (const req of baselineRequired) {
    if (!currentRequired.has(req) && req in currentProps) {
      changes.push({
        breaking: false,
        description: `Required property '${req}' was relaxed to optional.`,
        kind: "required_removed",
        path: `required.${req}`,
      });
    }
  }

  const isBreaking = changes.some((c) => c.breaking);

  return {
    breaking: isBreaking,
    changes,
    overrideEvidence: overrideEvidence?.trim() ? overrideEvidence.trim() : undefined,
    schemaName,
  };
}

/**
 * Gate schema compatibility across multiple schemas against a baseline with optional override evidence.
 */
export function evaluateSchemaCompatibilityGate(
  comparisons: readonly SchemaCompatibilityResult[],
  overrideEvidence?: string,
): SchemaCompatibilityGateResult {
  const breakingList = comparisons.filter((c) => c.breaking);
  const overrideValid = Boolean(overrideEvidence && overrideEvidence.trim().length >= 10);

  // If there are breaking changes, gate passes ONLY if valid override evidence is provided
  const passed = breakingList.length === 0 || overrideValid;

  return {
    breakingCount: breakingList.length,
    overrideEvidenceProvided: overrideValid,
    passed,
    results: comparisons,
    totalSchemas: comparisons.length,
  };
}
