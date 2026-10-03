import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { command, deadline, press, quit, ready, session, type } from "./drive.ts";
import type { Scenario } from "./types.ts";

export const pluginReload: Scenario = {
  name: "plugins.reload",
  covers: ["File watching", "Hot reload", "/reload", "Failed reload keeps the active plugin"],
  run: (context) =>
    session(
      context,
      {
        steps: [
          {
            name: "ready",
            prompt: "open a session",
            action: { kind: "reply", text: "Session ready" },
          },
        ],
      },
      async ({ terminal, workspace }) => {
        await terminal.waitForScreen(ready, deadline());
        await type(terminal, "open a session");
        await press(
          terminal,
          "chat.submit",
          (screen) => screen.text.includes("Session ready") && ready(screen),
        );
        const directory = join(workspace.cwd, ".nyte", "plugins", "reload-probe");
        const entry = join(directory, "index.ts");
        const evidence = join(workspace.cwd, "evidence", "plugin-setups");
        await mkdir(directory, { recursive: true });
        const install = (label: string) =>
          writeFile(
            entry,
            `
        import { appendFileSync } from "node:fs";
        let calls = 0;
        export default {
          id: "reload-probe",
          session(api) {
            api.commands.add("reload-probe", {
              description: "Check the active plugin",
              run: () => ${JSON.stringify(`Probe ${label}`)} + " " + (++calls),
            });
            appendFileSync(${JSON.stringify(evidence)}, ${JSON.stringify(`${label}\n`)});
          },
        };
      `,
          );
        const waitForSetups = async (expected: string[]) => {
          const until = deadline();
          while (performance.now() < until) {
            const actual = await readFile(evidence, "utf8").catch(() => "");
            if (actual === expected.join("\n") + "\n") return;
            await setTimeout(20);
          }
          assert.equal(await readFile(evidence, "utf8"), expected.join("\n") + "\n");
        };
        await install("first");
        await waitForSetups(["first"]);
        await command(terminal, "reload-probe", (screen) => screen.text.includes("Probe first 1"));
        await command(terminal, "reload", (screen) => screen.text.includes("Reloaded"));
        await waitForSetups(["first", "first"]);
        await install("second");
        await waitForSetups(["first", "first", "second"]);
        await command(terminal, "reload-probe", (screen) => screen.text.includes("Probe second 1"));
        await writeFile(entry, 'throw new Error("reload-probe failed");\n');
        await command(
          terminal,
          "reload",
          (screen) => screen.text.includes("error:") && ready(screen),
        );
        await command(terminal, "reload-probe", (screen) => screen.text.includes("Probe second 2"));
        await quit(terminal);
      },
    ),
};
