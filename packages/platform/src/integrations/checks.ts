export type CheckRun = {
  readonly annotations: number;
  readonly conclusion: "success" | "failure" | "neutral";
  readonly reportUrl: string;
  readonly suiteId: string;
};

export function createCheckRun(
  suiteId: string,
  passed: boolean,
  reportUrl: string,
  annotations: number,
): CheckRun {
  return {
    annotations,
    conclusion: passed ? "success" : "failure",
    reportUrl,
    suiteId,
  };
}

export function computeCheckRunKey(runId: string, suiteId: string): string {
  if (!runId || !suiteId) {
    throw new Error("runId and suiteId are required to compute check key.");
  }
  return `rampspec:run:${runId}:suite:${suiteId}`;
}
