export const service = { kind: "control-plane", name: "workflow" } as const;
export {
  WorkerHeartbeatTracker,
  type WorkerHeartbeatConfig,
  type WorkerStatus,
  type WorkerState,
} from "../../../packages/platform/src/index.js";
