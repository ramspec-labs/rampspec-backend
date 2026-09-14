import { expect, it } from "vitest";
import { filterTelemetry } from "./filter.js";
it("drops bodies and credentials from telemetry", () => expect(filterTelemetry({ runId: "r", body: "sensitive", token: "secret" })).toEqual({ runId: "r" }));
