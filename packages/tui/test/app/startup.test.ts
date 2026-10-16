import { expect, test } from "bun:test";
import { startTui } from "../harness/tui.ts";

test("keys typed before the app mounts reach the composer within 50 ms, while the host is still opening", async () => {
  await using tui = await startTui({ opened: false, typed: "typed at launch" });

  await tui.frame((frame) => frame.includes("❯ typed at launch"));
  const accepted = performance.now() - tui.mountedAt;

  expect(tui.store.state().facts.phase.kind).toBe("starting");
  expect(tui.store.screen().blocked).toEqual({ kind: "starting" });
  expect(accepted).toBeLessThanOrEqual(50);

  tui.openHost();
  await tui.ready();
  expect(tui.store.state().local.draft.text).toBe("typed at launch");
  expect(tui.captureCharFrame()).toContain("❯ typed at launch");
});
