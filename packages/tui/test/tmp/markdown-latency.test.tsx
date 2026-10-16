/**
 * How long a resumed transcript draws its markdown plain before the
 * highlights land. One process per variant, so the tree-sitter worker is cold.
 *   TURNS=40 WARM=1 bun test test/tmp/markdown-latency.test.tsx
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { asId } from "@nyte-ai/schema";
import { mountApp } from "../../src/app/main.tsx";
import { openCrashLog } from "../../src/effects/crash.ts";
import { hostPort } from "../../src/effects/host-port.ts";
import { systemClock } from "../../src/effects/local-ports.ts";
import { openTestHost } from "../fixture/host.ts";
import { fakeHost, fakePorts } from "../fixture/ports.ts";

process.env["NYTE_SKIP_VERSION_CHECK"] = "1";
const TURNS = Number(process.env["TURNS"] ?? 20);

const reply = (turn: number): string =>
  [
    `## Step ${turn}`,
    "Here is **what changed** and `why`, with a [link](https://example.com).",
    "- first point with **bold**\n- second point with `code`\n- third point",
    "```ts\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n```",
    `Closing line **MARK${turn}** done.`,
  ].join("\n\n");

test("markdown latency", async () => {
  await using fixture = await openTestHost();
  const session = await fixture.host.sessions.create();

  for (let turn = 0; turn < TURNS; turn++) {
    fixture.reply({ content: [{ type: "text", text: reply(turn) }] });
    const receipt = await session.send(`question ${turn}`);
    await receipt.settled();
  }

  const setup = await createTestRenderer({ width: 100, height: 32, kittyKeyboard: true });
  const home = mkdtempSync(join(tmpdir(), "nyte-md-latency-"));
  const fakes = fakePorts(fakeHost());
  const started = performance.now();

  const app = await mountApp({
    renderer: setup.renderer,
    ports: { ...fakes, host: hostPort(fixture.host, null), clock: systemClock, log: openCrashLog(home) },
    cwd: home,
    drawPart: () => null,
  });

  app.boot({ home, cwd: home, target: { kind: "session", id: asId(session.id) }, model: null, effort: null });
  const mark = `MARK${TURNS - 1}`;
  let shown = 0;
  let styled = 0;

  while (performance.now() - started < 30_000) {
    await setup.renderOnce();
    const frame = setup.captureCharFrame();

    const raw = frame.includes("**");

    if (shown === 0 && raw) shown = performance.now();

    if (shown !== 0 && frame.includes(mark) && !raw) {
      styled = performance.now();
      break;
    }
    await Bun.sleep(2);
  }

  console.log(
    `TURNS=${TURNS} WARM=${process.env["WARM"] ?? ""} plain=${(shown - started).toFixed(0)}ms styled=${(styled - started).toFixed(0)}ms plain-for=${(styled - shown).toFixed(0)}ms`,
  );
  await app.close();
  await setup.dispose();
  rmSync(home, { recursive: true, force: true });
}, 60_000);
