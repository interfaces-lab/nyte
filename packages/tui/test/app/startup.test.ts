import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { FileSettingsStore } from "../../src/services/settings.ts";
import { shownAt, startTui } from "../harness/tui.ts";

test("keys typed before the app mounts reach the composer within 50 ms, while the host is still opening", async () => {
  await using tui = await startTui({ opened: false, typed: "typed at launch", record: true });

  await tui.frame((frame) => frame.includes("❯ typed at launch"));

  expect(tui.store.state().facts.phase.kind).toBe("starting");
  expect(tui.store.screen().blocked).toEqual({ kind: "starting" });
  expect(shownAt(tui, "❯ typed at launch")).toBeLessThanOrEqual(50);

  tui.openHost();
  await tui.ready();
  expect(tui.store.state().local.draft.text).toBe("typed at launch");
  expect(tui.captureCharFrame()).toContain("❯ typed at launch");
});

test("a settings file that doesn't parse is left out of the first frame's settings, and a notice names it", async () => {
  const root = mkdtempSync(join(tmpdir(), "nyte-settings-"));
  const global = join(root, "settings.json");
  mkdirSync(join(root, ".nyte"));
  writeFileSync(global, '{ "theme": "light", "followUp": "sideways" }\n');
  writeFileSync(join(root, ".nyte", "settings.json"), '{ "copyOnSelect": true }\n');
  const store = new FileSettingsStore(global);

  try {
    await using tui = await startTui({
      opened: false,
      settings: { read: () => store.read(root), write: async () => store.read(root).settings },
    });

    await tui.frame((frame) => frame.includes("Ignored"));
    expect(tui.store.state().facts.settings).toMatchObject({ theme: "auto", copyOnSelect: true });
    expect(tui.store.state().local.notice?.text).toBe(
      `Ignored ${global}: settings.followUp must be steer or queue`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
