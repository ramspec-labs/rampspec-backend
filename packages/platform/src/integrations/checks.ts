export type CheckRun = { suiteId: string; conclusion: "success" | "failure" | "neutral"; reportUrl: string; annotations: number };
export function createCheckRun(suiteId: string, passed: boolean, reportUrl: string, annotations: number): CheckRun { return { suiteId, conclusion: passed ? "success" : "failure", reportUrl, annotations }; }
