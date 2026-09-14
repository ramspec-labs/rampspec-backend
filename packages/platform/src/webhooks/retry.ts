export function webhookRetryDelay(attempt: number, cap = 86_400_000) { return Math.min(1000 * 2 ** Math.max(0, attempt), cap); }
