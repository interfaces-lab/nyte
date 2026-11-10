import { expect, test } from "bun:test";
import { exitStatus } from "../../src/lifecycle.ts";
import { openTestHost } from "../fixture/host.ts";
import { startTui } from "../harness/tui.ts";
import type { Tui } from "../harness/tui.ts";

const HANGUP = exitStatus("SIGHUP");

const CASES: readonly (readonly [string, (app: Tui) => void])[] = [
  ["stdin ending, as a closed terminal tab's does,", (app) => app.renderer.stdin.push(null)],
  [
    "a stdin read error, as a revoked terminal's EIO,",
    (app) => app.renderer.stdin.destroy(Object.assign(new Error("read EIO"), { code: "EIO" })),
  ],
  [
    "the renderer torn down under the app, as a failed terminal write does,",
    (app) => app.renderer.destroy(),
  ],
];

test.each(CASES)("%s closes the app as a hangup", async (_name, trigger) => {
  await using fixture = await openTestHost();
  await using app = await startTui({ fixture });
  await app.ready();

  trigger(app);

  expect(await app.app.closing).toBe(HANGUP);
});
