import { describe, expect, it } from "vitest";
import { Metrics } from "./metrics.js";

describe("metrics", () => {
  it("records counters and latency percentiles", () => {
    const metrics = new Metrics();
    metrics.increment("runs.completed", { service: "api" });
    metrics.increment("runs.completed", { service: "api" });
    metrics.observe("run.latency", 10);
    metrics.observe("run.latency", 20);
    expect(metrics.counter("runs.completed")).toBe(2);
    expect(metrics.percentile("run.latency", 0.5)).toBe(20);
  });

  it("rejects invalid observations and percentiles", () => {
    const metrics = new Metrics();
    expect(() => metrics.observe("x", -1)).toThrow("observation");
    expect(() => metrics.percentile("x", 2)).toThrow("percentile");
  });

  it("records bounded database pool health metrics", () => {
    const metrics = new Metrics();
    metrics.recordPoolHealth(
      {
        totalCount: 10,
        idleCount: 7,
        activeCount: 3,
        waitingCount: 0,
        timeouts: 0
      },
      { pool: "primary" }
    );

    expect(metrics.gauge("db_pool_total_connections")).toBe(10);
    expect(metrics.gauge("db_pool_idle_connections")).toBe(7);
    expect(metrics.gauge("db_pool_active_connections")).toBe(3);
    expect(metrics.gauge("db_pool_waiting_requests")).toBe(0);
    expect(metrics.gauge("db_pool_connection_timeouts_total")).toBe(0);
  });

  it("blocks sensitive connection strings, queries, and tenant identifiers from metric labels", () => {
    const metrics = new Metrics();
    expect(() =>
      metrics.recordPoolHealth(
        { totalCount: 5, idleCount: 2, activeCount: 3, waitingCount: 0, timeouts: 0 },
        { tenant_id: "tenant-123" }
      )
    ).toThrow("Forbidden label");

    expect(() =>
      metrics.setGauge("custom_stat", 1, { conn_string: "postgres://..." })
    ).toThrow("Forbidden label");

    expect(() =>
      metrics.setGauge("custom_stat", 1, { query: "SELECT 1" })
    ).toThrow("Forbidden label");
  });
});
