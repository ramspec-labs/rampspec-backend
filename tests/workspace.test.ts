import { describe, expect, it } from "vitest";

import { service as api } from "../apps/api/src/index.js";
import { service as browser } from "../apps/browser/src/index.js";
import { service as cli } from "../apps/cli/src/index.js";
import { service as evidence } from "../apps/evidence/src/index.js";
import { service as gateway } from "../apps/gateway/src/index.js";
import { service as report } from "../apps/report/src/index.js";
import { service as scheduler } from "../apps/scheduler/src/index.js";
import { service as webhook } from "../apps/webhook/src/index.js";
import { service as workflow } from "../apps/workflow/src/index.js";

describe("backend workspace", () => {
  it("exposes every planned application entrypoint", () => {
    const names = [api, browser, cli, evidence, gateway, report, scheduler, webhook, workflow]
      .map(({ name }) => name)
      .sort();

    expect(names).toEqual([
      "api",
      "browser",
      "cli",
      "evidence",
      "gateway",
      "report",
      "scheduler",
      "webhook",
      "workflow",
    ]);
  });
});
