import worker, { NyteHost } from "../../src/deploy/cloudflare/worker.ts";
import type { WorkerEnv, WorkerState } from "../../src/deploy/cloudflare/worker.ts";
import { fakeModels } from "../fake-models.ts";

const fake = fakeModels();

fake.reply(
  { content: [{ type: "text", text: "Driven by the alarm." }] },
  { content: [{ type: "text", text: "Driven by the next alarm." }] },
);

/** The Worker's `NyteHost` with the fake provider's models, so a turn runs without a network. */
export class TestHost extends NyteHost {
  constructor(state: WorkerState, env: WorkerEnv) {
    super(state, env, { models: fake.models });
  }
}

/** The Worker's own entry: every request goes to the one host object. */
export default worker;
