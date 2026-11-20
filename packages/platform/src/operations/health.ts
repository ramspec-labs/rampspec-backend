export type DependencyName = "database" | "objectStore" | "scheduler" | "signing" | (string & {});

export interface ComponentReadiness {
  readonly ready: boolean;
  readonly status: "ready" | "not_ready";
}

export interface ReadinessResult {
  readonly checks: Readonly<Record<string, boolean>>;
  readonly components: Readonly<Record<string, ComponentReadiness>>;
  readonly status: "ready" | "not_ready";
}

export interface HealthCheck {
  readonly check: () => Promise<boolean>;
  readonly name: string;
  readonly timeoutMs?: number;
}

export interface StandardReadinessChecks {
  readonly database: () => Promise<boolean>;
  readonly objectStore: () => Promise<boolean>;
  readonly scheduler: () => Promise<boolean>;
  readonly signing: () => Promise<boolean>;
}

const DEFAULT_TIMEOUT_MS = 5000;

function executeBoundedCheck(
  check: () => Promise<boolean>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    }, timeoutMs);

    Promise.resolve()
      .then(() => check())
      .then(
        (res) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(Boolean(res));
          }
        },
        () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(false);
          }
        },
      );
  });
}

export async function readiness(
  checks: readonly HealthCheck[],
  options: { readonly timeoutMs?: number } = {},
): Promise<ReadinessResult> {
  const checksMap: Record<string, boolean> = {};
  const componentsMap: Record<string, ComponentReadiness> = {};

  await Promise.all(
    checks.map(async (check) => {
      const timeout = check.timeoutMs ?? options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const isReady = await executeBoundedCheck(check.check, timeout);
      checksMap[check.name] = isReady;
      componentsMap[check.name] = {
        ready: isReady,
        status: isReady ? "ready" : "not_ready",
      };
    }),
  );

  const isAllReady = Object.values(checksMap).length > 0 && Object.values(checksMap).every(Boolean);

  return {
    checks: checksMap,
    components: componentsMap,
    status: isAllReady ? "ready" : "not_ready",
  };
}

export async function checkStandardReadiness(
  checks: StandardReadinessChecks,
  options: { readonly timeoutMs?: number } = {},
): Promise<ReadinessResult> {
  const healthChecks: HealthCheck[] = [
    { check: checks.database, name: "database" },
    { check: checks.objectStore, name: "objectStore" },
    { check: checks.scheduler, name: "scheduler" },
    { check: checks.signing, name: "signing" },
  ];
  return readiness(healthChecks, options);
}

export function liveness(): { readonly status: "ok" } {
  return { status: "ok" };
}
