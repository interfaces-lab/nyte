import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { expect, test } from "bun:test";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { openPty } from "./pty.ts";
import type { Pty } from "./pty.ts";
import { freshHome, PLUGIN_ANSWER, readBinaryCode, serveForBinary } from "./service.ts";
import type { TestService } from "./service.ts";

const BINARY =
  process.env["NYTE_BINARY"] ?? fileURLToPath(new URL("../../../bin/nyte", import.meta.url));

const CODE = await readBinaryCode(BINARY);

const RESUME = /To resume previous session\nnyte --session=([^\n]+)\n$/u;

const PrintRecord = Type.Object({
  type: Type.String(),
  text: Type.Optional(Type.String()),
  kind: Type.Optional(Type.String()),
});

async function print(
  service: TestService,
  args: readonly string[],
  progress?: (stdout: string) => void,
) {
  const child = Bun.spawn([BINARY, ...args], {
    cwd: service.cwd,
    env: { ...service.env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const decoder = new TextDecoder();
  let stdout = "";

  for await (const chunk of child.stdout) {
    stdout += decoder.decode(chunk, { stream: true });
    progress?.(stdout);
  }

  return { code: await child.exited, records: records(stdout) };
}

function records(stdout: string) {
  return stdout
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const value: unknown = JSON.parse(line);

      if (!Value.Check(PrintRecord, value)) throw new Error(`Not a print record: ${line}`);

      return value;
    });
}

const ready = (pty: Pty) =>
  pty.waitFor((screen) => screen.text.includes("enter send") && !screen.text.includes("Loading"));

/** How long the binary may take to exit after it is told to, by a signal or a closed terminal. */
const EXIT_BUDGET_MS = 2_000;

/** The status `pty` exits with and the milliseconds it took from `from`; throws if it outlives the budget. */
async function exitTimed(pty: Pty, from: number) {
  const status = await Promise.race([pty.exited(), Bun.sleep(EXIT_BUDGET_MS * 2).then(() => null)]);
  const elapsed = performance.now() - from;

  if (status === null)
    throw new Error(
      `The TUI was still running ${String(EXIT_BUDGET_MS * 2)} ms after it was told to exit.`,
    );

  return { status, elapsed };
}

/** Resolves once `done` holds, checking every 10 ms; throws after the exit budget. */
async function eventually(done: () => boolean, what: string): Promise<void> {
  const deadline = performance.now() + EXIT_BUDGET_MS;

  while (!done()) {
    if (performance.now() > deadline) throw new Error(`Never saw ${what}.`);
    await Bun.sleep(10);
  }
}

test("--help prints plain usage and exits 0", async () => {
  const child = Bun.spawn([BINARY, "--help"], { stdout: "pipe", stderr: "pipe", env: {} });

  expect(await child.exited).toBe(0);
  expect(await new Response(child.stdout).text()).toContain("usage:");
});

test("-p --json streams text while the provider still streams, then a completed result", async () => {
  await using service = await serveForBinary({ plugin: false, code: CODE });
  const release = Promise.withResolvers<void>();
  service.reply({
    content: [{ type: "text", text: "Streaming from the fake provider." }],
    tokens: 2,
    tap: (streamed) => (streamed === 1 ? release.promise : undefined),
  });

  const run = await print(service, ["-p", "--json", "say something"], (stdout) => {
    if (stdout.includes('"type":"text"')) release.resolve();
  });

  expect(run.code).toBe(0);
  expect(
    run.records
      .filter((record) => record.type === "text")
      .map((record) => record.text)
      .join(""),
  ).toBe("Streaming from the fake provider.");
  expect(run.records.at(-1)).toMatchObject({ type: "result", kind: "completed" });
});

test("a provider error exits 1 with a failed result", async () => {
  await using service = await serveForBinary({ plugin: false, code: CODE });
  service.reply({ error: "The fake provider failed." });

  const run = await print(service, ["-p", "--json", "fail please"]);

  expect(run.code).toBe(1);
  expect(run.records.at(-1)).toMatchObject({ type: "result", kind: "failed" });
});

test("SIGTERM during a run exits 143 with a cancelled result", async () => {
  await using service = await serveForBinary({ plugin: false, code: CODE });
  service.reply({
    content: [{ type: "text", text: "Holding the stream open" }],
    hold: true,
  });
  let terminated = false;

  const child = Bun.spawn([BINARY, "-p", "--json", "hold on"], {
    cwd: service.cwd,
    env: { ...service.env },
    stdout: "pipe",
    stderr: "pipe",
  });

  const decoder = new TextDecoder();
  let stdout = "";

  for await (const chunk of child.stdout) {
    stdout += decoder.decode(chunk, { stream: true });

    if (!terminated && stdout.includes('"type":"text"')) {
      terminated = true;
      child.kill("SIGTERM");
    }
  }

  expect(await child.exited).toBe(143);
  expect(records(stdout).at(-1)).toMatchObject({ type: "result", kind: "cancelled" });
});

test("before its service is registered, the TUI paints the recorded model and keys typed at launch, and takes Enter", async () => {
  await using home = await freshHome();
  const recorded = { model: { provider: "test", id: "recorded" }, effort: "off", fast: false };
  await writeFile(join(home.nyteHome, "tui-first-frame.json"), `${JSON.stringify(recorded)}\n`);
  await using pty = await openPty({ binary: BINARY, cwd: home.cwd, env: home.env, typed: "hi" });

  await pty.waitFor(
    (screen) => screen.text.includes("❯ hi") && screen.text.includes("│ recorded │"),
  );
  const painted = performance.now() - pty.spawnedAt;
  const registered = existsSync(home.registration);
  pty.press("chat.submit");
  await pty.waitFor((screen) => screen.text.includes("sends when Nyte connects"));
  const accepted = performance.now() - pty.spawnedAt;
  const registeredAtSend = existsSync(home.registration);
  console.log(
    `spawn to the composer with typed keys and the recorded model: ${painted.toFixed(0)} ms; to the sent message waiting for the host: ${accepted.toFixed(0)} ms`,
  );

  expect(registered).toBe(false);
  expect(registeredAtSend).toBe(false);
}, 30_000);

test("the TUI asks to trust a folder with project files; trusting it loads the plugin's command", async () => {
  await using service = await serveForBinary({ plugin: true, code: CODE });
  await using pty = await openPty({ binary: BINARY, cwd: service.cwd, env: service.env });

  await pty.waitFor((screen) => screen.text.includes("Trust this folder"));
  pty.press("picker.accept");
  await ready(pty);
  pty.type("/qa-probe");
  await pty.waitFor((screen) => screen.text.includes("Show that the project plugin loaded"));
  pty.press("chat.submit");
  await pty.waitFor((screen) => screen.text.includes(PLUGIN_ANSWER));
}, 30_000);

test("the TUI keeps keys typed at launch, streams a reply, and prints the resume command on /quit and SIGTERM", async () => {
  await using service = await serveForBinary({ plugin: false, code: CODE });
  service.reply(
    { content: [{ type: "text", text: "Hello from the fake provider." }] },
    { content: [{ type: "text", text: "Resumed and answered." }] },
  );

  const first = await openPty({
    binary: BINARY,
    cwd: service.cwd,
    env: service.env,
    typed: "hi nyte",
  });

  await first.waitFor((screen) => screen.text.includes("❯ hi nyte"));
  await ready(first);
  first.press("chat.submit");
  await first.waitFor((screen) => screen.text.includes("Hello from the fake provider."));
  first.type("/quit");
  await first.waitFor((screen) => screen.text.includes("❯ /quit"));
  first.press("chat.submit");
  expect(await first.exited()).toBe(0);
  const session = RESUME.exec(first.output())?.[1];
  await first[Symbol.asyncDispose]();

  if (session === undefined) throw new Error("The exit text named no session.");

  await using resumed = await openPty({
    binary: BINARY,
    args: [`--session=${session}`],
    cwd: service.cwd,
    env: service.env,
  });

  await resumed.waitFor((screen) => screen.text.includes("Hello from the fake provider."));
  await ready(resumed);
  resumed.type("after the restart");
  await resumed.waitFor((screen) => screen.text.includes("❯ after the restart"));
  resumed.press("chat.submit");
  await resumed.waitFor((screen) => screen.text.includes("Resumed and answered."));
  expect(JSON.stringify(service.requests.at(-1)?.context.messages)).toContain("hi nyte");

  resumed.signal("SIGTERM");
  expect(await resumed.exited()).toBe(143);
  expect(RESUME.exec(resumed.output())?.[1]).toBe(session);
}, 30_000);

test("closing the terminal ends the TUI within 2 s with 129, and the service sees its connection close", async () => {
  await using service = await serveForBinary({ plugin: false, code: CODE });
  await using pty = await openPty({ binary: BINARY, cwd: service.cwd, env: service.env });
  await ready(pty);
  const connected = service.disconnects();

  const from = performance.now();
  pty.hangUp();
  const { status, elapsed } = await exitTimed(pty, from);

  expect(status).toBe(129);
  expect(elapsed).toBeLessThan(EXIT_BUDGET_MS);
  await eventually(() => service.disconnects() > connected, "the client's streams close");
}, 30_000);

test("SIGTERM to a TUI whose terminal already closed ends it within 2 s", async () => {
  await using service = await serveForBinary({ plugin: false, code: CODE });
  await using pty = await openPty({ binary: BINARY, cwd: service.cwd, env: service.env });
  await ready(pty);

  const from = performance.now();
  pty.hangUp();
  pty.signal("SIGTERM");
  const { status, elapsed } = await exitTimed(pty, from);

  expect([129, 143]).toContain(status);
  expect(elapsed).toBeLessThan(EXIT_BUDGET_MS);
}, 30_000);

test("SIGHUP ends the TUI within 2 s with 129 and prints the resume command", async () => {
  await using service = await serveForBinary({ plugin: false, code: CODE });
  await using pty = await openPty({ binary: BINARY, cwd: service.cwd, env: service.env });
  await ready(pty);

  const from = performance.now();
  pty.signal("SIGHUP");
  const { status, elapsed } = await exitTimed(pty, from);

  expect(status).toBe(129);
  expect(elapsed).toBeLessThan(EXIT_BUDGET_MS);
  expect(pty.output()).toMatch(RESUME);
}, 30_000);

test("the TUI exits 1 within 2 s with the reason and the resume command when its service stops", async () => {
  await using service = await serveForBinary({ plugin: false, code: CODE });
  service.reply({ content: [{ type: "text", text: "Answered before the restart." }] });
  await using pty = await openPty({ binary: BINARY, cwd: service.cwd, env: service.env });
  await ready(pty);
  pty.type("hi nyte");
  pty.press("chat.submit");
  await pty.waitFor((screen) => screen.text.includes("Answered before the restart."));

  const from = performance.now();
  await service.stop();
  const { status, elapsed } = await exitTimed(pty, from);

  expect(status).toBe(1);
  expect(elapsed).toBeLessThan(EXIT_BUDGET_MS);
  expect(pty.output()).toContain(
    "The Nyte service stopped, or a nyte of another build replaced it, so this TUI lost its connection.",
  );
  expect(pty.output()).toMatch(RESUME);
}, 30_000);
