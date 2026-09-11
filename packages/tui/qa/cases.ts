import assert from "node:assert/strict";
import { deadline, output, ready, resumeSession, session } from "./drive.ts";
import type { Scenario } from "./types.ts";

/** Boundaries a journey cannot host: the CLI itself and OS signals. */
export const cases: Scenario[] = [
  {
    name: "launch.help",
    covers: ["CLI boundaries", "compiled binary startup"],
    async run(context) {
      const terminal = await context.open({ args: ["--help"] });
      assert.equal(await terminal.waitForExit(deadline()), 0);
      await terminal.waitForScreen((screen) => screen.text.includes("--session"), deadline());
      assert.match(output(terminal), /--session/u);
    },
  },
  {
    name: "exit.signals.two-lines",
    covers: ["Terminal lifecycle and integrations", "copyable resume", "SIGINT", "SIGTERM"],
    run: (context) =>
      session(context, {}, async ({ terminal, reopen }) => {
        await terminal.waitForScreen(ready, deadline());
        terminal.signal("SIGINT");
        await resumeSession(terminal, 130);
        const second = await reopen();
        await second.waitForScreen(ready, deadline());
        second.signal("SIGTERM");
        await resumeSession(second, 143);
      }),
  },
];
