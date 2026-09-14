import { expect, it } from "vitest";
import { RunEventLog } from "./events.js";
it("replays monotonic events after a cursor", () => { const log = new RunEventLog(); log.append("run-1", "started", {}); log.append("run-1", "completed", {}); expect(log.since("run-1", 1)).toHaveLength(1); });
