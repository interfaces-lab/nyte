import {
  BLOCKED,
  INTERRUPTED,
  NEEDS_INPUT,
  PENDING,
  RUNNING,
  STOPPED,
  type Section,
  TEST_OUTPUT,
  TYPE_ERRORS,
  call,
  failed,
  lone,
  ok,
  read,
  shell,
} from "../build";

export const statesSection: Section = {
  id: "states",
  title: "Tool states",
  detail:
    "ToolPartState carries the phase and outcome; the part status says when it waits. toolStatus maps it to a tense, a tone and an outcome word.",
  specimens: [
    lone("state-pending", "Pending", 'phase = "calling"', call(shell("pnpm test"), PENDING, 0)),
    lone("state-running", "Running", 'phase = "running"', call(shell("pnpm test"), RUNNING, 0)),
    lone(
      "state-input",
      "Needs input",
      "running · status = waiting on a part",
      call(shell("pnpm test"), NEEDS_INPUT, 0),
    ),
    lone(
      "state-success",
      "Succeeded",
      'outcome = "ok"',
      call(shell("pnpm test"), ok(), 0, TEST_OUTPUT),
    ),
    lone(
      "state-exit",
      "Exited nonzero",
      'outcome = "failed" · shell output',
      call(shell("pnpm test"), failed(TYPE_ERRORS), 0),
    ),
    lone(
      "state-error",
      "Failed",
      'outcome = "failed"',
      call(read("packages/lab/missing.ts"), failed("ENOENT: no such file or directory"), 0),
    ),
    lone(
      "state-denied",
      "Blocked",
      'outcome = "rejected"',
      call(shell("rm -rf node_modules"), BLOCKED, 0),
    ),
    lone(
      "state-cancelled",
      "Stopped",
      'outcome = "stopped"',
      call(shell("pnpm build"), STOPPED, 0),
    ),
    lone(
      "state-interrupted",
      "Interrupted",
      'outcome = "interrupted"',
      call(read("packages/app/src/live.ts"), INTERRUPTED, 0),
    ),
  ],
};
