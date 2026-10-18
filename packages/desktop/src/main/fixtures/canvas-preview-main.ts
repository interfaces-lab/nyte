import assert from "node:assert/strict";
import { createSocket } from "node:dgram";
import { writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import process from "node:process";
import { app } from "electron";
import { readCanvasFixture } from "@nyte-ai/canvas/fixtures";
import { compileCanvas } from "@nyte-ai/plugin/core/canvas-compile";
import { ACCOUNT_SCHEMES } from "../../account/scheme.ts";
import { offscreenCanvasPreviewer } from "../canvas-preview.ts";
import { registerRenderer } from "../renderer.ts";
import { exitWithParent } from "./exit-with-parent.ts";

exitWithParent();

const directory = process.argv[2];

const shellRoot = process.argv[3];

const fixture = process.argv[4];

const probeFolder = process.argv[5];

assert.ok(
  directory !== undefined &&
    shellRoot !== undefined &&
    fixture !== undefined &&
    probeFolder !== undefined,
);

app.setPath("userData", join(directory, "profile"));

app.commandLine.appendSwitch("use-fake-device-for-media-stream");

app.on("window-all-closed", () => undefined);

const scheme = ACCOUNT_SCHEMES.development;

process.env.ELECTRON_RENDERER_URL = "http://127.0.0.1:9";

registerRenderer({ scheme, frontendApiHost: undefined, shellRoot });

const preview = offscreenCanvasPreviewer(scheme, shellRoot, join(directory, "driver.cjs"));

async function probe() {
  const udp = createSocket("udp4");
  let packets = 0;
  udp.on("message", () => (packets += 1));
  await new Promise<void>((resolve) => udp.bind(0, "127.0.0.1", resolve));
  let connections = 0;
  const tcp = createServer((socket) => {
    connections += 1;
    socket.destroy();
  });
  await new Promise<void>((resolve) => tcp.listen(0, "127.0.0.1", resolve));
  const address = tcp.address();
  assert.ok(address !== null && typeof address !== "string");
  const { source, files } = await readCanvasFixture(probeFolder ?? "");
  const compiled = await compileCanvas(source, {
    ...files,
    "ports.ts": `export const ports = { stun: ${udp.address().port}, turn: ${address.port} };`,
  });

  if (compiled.kind === "failed") throw new Error(JSON.stringify(compiled.errors));
  const reports: unknown[] = [];

  for (const _run of [1, 2]) {
    const outcome = await preview(
      {
        module: { runtime: compiled.runtime, code: compiled.code, title: "Probe" },
        theme: "light",
      },
      AbortSignal.timeout(30_000),
    );

    if (outcome.kind !== "rendered") throw new Error(outcome.reason);
    const line = outcome.report.console.find((entry) => entry.text.startsWith("probe "));
    reports.push(JSON.parse(line?.text.slice("probe ".length) ?? "null"));
  }

  udp.close();
  tcp.close();

  return { reports, traffic: { packets, connections } };
}

async function run(): Promise<void> {
  const { source, files } = await readCanvasFixture(fixture);
  const compiled = await compileCanvas(source, files);

  if (compiled.kind === "failed") throw new Error(JSON.stringify(compiled.errors));
  await app.whenReady();
  const results = [];

  for (const theme of ["dark", "light"] as const) {
    const outcome = await preview(
      { module: { runtime: compiled.runtime, code: compiled.code, title: "Fixture" }, theme },
      new AbortController().signal,
    );

    if (outcome.kind !== "rendered") throw new Error(outcome.reason);
    writeFileSync(join(directory, `preview-${theme}.png`), outcome.report.png);
    results.push({ theme, ...outcome.report, png: outcome.report.png.byteLength });
  }

  const hung = await compileCanvas("export default function Loop() {\n  for (;;) {}\n}");
  const plain = await compileCanvas(
    'import { Text } from "nyte/canvas";\nexport default () => <Text>After the loop</Text>;',
  );

  if (hung.kind === "failed" || plain.kind === "failed")
    throw new Error("A probe did not compile.");
  const started = performance.now();
  const stuck = await preview(
    { module: { runtime: hung.runtime, code: hung.code, title: "Loop" }, theme: "light" },
    AbortSignal.timeout(3000),
  );
  const stoppedAfter = performance.now() - started;
  const after = await preview(
    { module: { runtime: plain.runtime, code: plain.code, title: "After" }, theme: "light" },
    AbortSignal.timeout(30_000),
  );

  writeFileSync(
    join(directory, "result.json"),
    JSON.stringify(
      {
        galaxy: results,
        hung: { kind: stuck.kind, ms: Math.round(stoppedAfter) },
        after: after.kind === "rendered" ? { kind: after.kind, ...after.report, png: 0 } : after,
        probe: await probe(),
      },
      null,
      2,
    ),
  );
}

run().then(
  () => {
    writeFileSync(join(directory, "result.txt"), "passed");
    app.exit(0);
  },
  (error: Error) => {
    writeFileSync(join(directory, "result.txt"), error.stack ?? error.message);
    app.exit(0);
  },
);
