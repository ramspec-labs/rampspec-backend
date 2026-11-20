export interface PoolHealthMetricsInput {
  readonly totalCount: number;
  readonly idleCount: number;
  readonly waitingCount: number;
  readonly activeCount: number;
  readonly timeouts: number;
}

export class Metrics {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly latency = new Map<string, number[]>();

  increment(name: string, labels: Readonly<Record<string, string>> = {}): void {
    const key = `${name}{${Object.entries(labels)
      .sort()
      .map(([k, v]) => `${k}=${v}`)
      .join(",")}}`;
    if (key.length > 256) throw new Error("Metric label set is too large.");
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
  }

  setGauge(name: string, value: number, labels: Readonly<Record<string, string>> = {}): void {
    if (!Number.isFinite(value)) throw new Error("Invalid gauge value.");
    // Validate bounded labels and prevent high cardinality / connection string leakage
    const labelEntries = Object.entries(labels);
    for (const [k, v] of labelEntries) {
      if (k.toLowerCase().includes("conn") || k.toLowerCase().includes("tenant") || k.toLowerCase().includes("query")) {
        throw new Error(`Forbidden label key '${k}' to prevent sensitive or high-cardinality leakage.`);
      }
      if (v.length > 64) {
        throw new Error("Metric label value is too long.");
      }
    }
    const key = `${name}{${labelEntries
      .sort()
      .map(([k, v]) => `${k}=${v}`)
      .join(",")}}`;
    if (key.length > 256) throw new Error("Metric label set is too large.");
    this.gauges.set(key, value);
  }

  recordPoolHealth(poolMetrics: PoolHealthMetricsInput, labels: Readonly<Record<string, string>> = {}): void {
    this.setGauge("db_pool_total_connections", poolMetrics.totalCount, labels);
    this.setGauge("db_pool_idle_connections", poolMetrics.idleCount, labels);
    this.setGauge("db_pool_active_connections", poolMetrics.activeCount, labels);
    this.setGauge("db_pool_waiting_requests", poolMetrics.waitingCount, labels);
    this.setGauge("db_pool_connection_timeouts_total", poolMetrics.timeouts, labels);
  }

  observe(name: string, milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0)
      throw new Error("Invalid metric observation.");
    const values = this.latency.get(name) ?? [];
    if (values.length < 10_000) values.push(milliseconds);
    this.latency.set(name, values);
  }

  counter(name: string): number {
    return [...this.counters.entries()]
      .filter(([key]) => key.startsWith(`${name}{`))
      .reduce((total, [, value]) => total + value, 0);
  }

  gauge(name: string): number | undefined {
    const entry = [...this.gauges.entries()].find(([key]) => key.startsWith(`${name}{`));
    return entry ? entry[1] : undefined;
  }

  percentile(name: string, percentile: number): number {
    if (percentile < 0 || percentile > 1)
      throw new Error("Invalid percentile.");
    const values = [...(this.latency.get(name) ?? [])].sort((a, b) => a - b);
    return values.length
      ? values[Math.min(values.length - 1, Math.floor(percentile * values.length))]!
      : 0;
  }

  toPrometheusText(): string {
    const lines: string[] = [];
    for (const [key, value] of [...this.gauges.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`${key} ${value}`);
    }
    for (const [key, value] of [...this.counters.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`${key} ${value}`);
    }
    for (const [name, values] of [...this.latency.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (values.length === 0) continue;
      const sorted = [...values].sort((a, b) => a - b);
      const sum = sorted.reduce((acc, val) => acc + val, 0);
      const p50 = sorted[Math.floor(0.5 * sorted.length)]!;
      const p95 = sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))]!;
      const p99 = sorted[Math.min(sorted.length - 1, Math.floor(0.99 * sorted.length))]!;
      lines.push(`${name}_count ${sorted.length}`);
      lines.push(`${name}_sum ${sum}`);
      lines.push(`${name}{quantile="0.5"} ${p50}`);
      lines.push(`${name}{quantile="0.95"} ${p95}`);
      lines.push(`${name}{quantile="0.99"} ${p99}`);
    }
    return lines.join("\n") + (lines.length > 0 ? "\n" : "");
  }
}

export const defaultMetrics = new Metrics();
