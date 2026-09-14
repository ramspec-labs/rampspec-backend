export type Submission = { id: string; reportHash: string; state: "simulated" | "submitted" | "confirmed" | "failed"; ledger?: number };
export function confirmSubmission(submission: Submission, ledger: number) { if (submission.state !== "submitted") throw new Error("Submission is not awaiting confirmation."); return Object.freeze({ ...submission, state: "confirmed" as const, ledger }); }
