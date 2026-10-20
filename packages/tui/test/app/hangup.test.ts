import { expect, test } from "bun:test";
import { exitStatus } from "../../src/lifecycle.ts";
import { openTestHost } from "../fixture/host.ts";
import { startTui } from "../harness/tui.ts";

const HANGUP = exitStatus("SIGHUP");

test("stdin ending, as a closed terminal tab's does, closes the app as a hangup", async () => {
  await using fixture = await openTestHost();
  await using app = await startTui({ fixture });
  await app.ready();

  app.renderer.stdin.push(null);

  expect(await app.app.closing).toBe(HANGUP);
});

test("a stdin read error, as a revoked terminal's EIO, closes the app as a hangup", async () => {
  await using fixture = await openTestHost();
  await using app = await startTui({ fixture });
  await app.ready();

  app.renderer.stdin.destroy(Object.assign(new Error("read EIO"), { code: "EIO" }));

  expect(await app.app.closing).toBe(HANGUP);
});

test("the renderer torn down under the app, as a failed terminal write does, closes it as a hangup", async () => {
  await using fixture = await openTestHost();
  await using app = await startTui({ fixture });
  await app.ready();

  app.renderer.destroy();

  expect(await app.app.closing).toBe(HANGUP);
});
