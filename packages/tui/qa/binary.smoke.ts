import { existsSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { expect, test } from "bun:test";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { openPty } from "./pty.ts";
import type { Pty } from "./pty.ts";
import { freshHome, PLUGIN_ANSWER, serveForBinary } from "./service.ts";
import type { TestService } from "./service.ts";

const BINARY =
  process.env["NYTE_BINARY"] ?? fileURLToPath(new URL("../dist/nyte", import.meta.url));

const RESUME = /To resume previous session\nnyte --session=([^\n]+)\n$/u;

const Listening = Type.Object({
  type: Type.Literal("listening"),
  url: Type.String(),
  endpoint: Type.String(),
  pid: Type.Integer(),
});

const HostFile = Type.Object({ url: Type.String(), token: Type.String(), pid: Type.Integer() });

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

const EXIT_BUDGET_MS = 2_000;

async function exitTimed(pty: Pty, from: number) {
  const status = await Promise.race([pty.exited(), Bun.sleep(EXIT_BUDGET_MS * 2).then(() => null)]);
  const elapsed = performance.now() - from;

  if (status === null)
    throw new Error(
      `The TUI was still running ${String(EXIT_BUDGET_MS * 2)} ms after it was told to exit.`,
    );

  return { status, elapsed };
}

test("--help prints plain usage and exits 0", async () => {
  const child = Bun.spawn([BINARY, "--help"], { stdout: "pipe", stderr: "pipe", env: {} });

  expect(await child.exited).toBe(0);
  expect(await new Response(child.stdout).text()).toContain("usage:");
});

test("-p --json streams text while the provider still streams, then a completed result", async () => {
  await using service = await serveForBinary({ plugin: false });
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
  await using service = await serveForBinary({ plugin: false });
  service.reply({ error: "The fake provider failed." });

  const run = await print(service, ["-p", "--json", "fail please"]);

  expect(run.code).toBe(1);
  expect(run.records.at(-1)).toMatchObject({ type: "result", kind: "failed" });
});

test("SIGTERM during a run exits 143 with a cancelled result", async () => {
  await using service = await serveForBinary({ plugin: false });
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

test("before its host opens, the TUI paints the recorded model and keys typed at launch, and takes Enter", async () => {
  await using home = await freshHome();
  const recorded = { model: { provider: "test", id: "recorded" }, effort: "off", fast: false };
  await writeFile(join(home.nyteHome, "tui-first-frame.json"), `${JSON.stringify(recorded)}\n`);
  await using pty = await openPty({ binary: BINARY, cwd: home.cwd, env: home.env, typed: "hi" });

  await pty.waitFor(
    (screen) => screen.text.includes("❯ hi") && screen.text.includes("│ recorded │"),
  );
  const painted = performance.now() - pty.spawnedAt;
  pty.press("chat.submit");
  await pty.waitFor((screen) => screen.text.includes("sends when Nyte connects"));
  const accepted = performance.now() - pty.spawnedAt;
  console.log(
    `spawn to the composer with typed keys and the recorded model: ${painted.toFixed(0)} ms; to the sent message waiting for the host: ${accepted.toFixed(0)} ms`,
  );
}, 30_000);

test("the TUI asks to trust a folder with project files; trusting it loads the plugin's command", async () => {
  await using service = await serveForBinary({ plugin: true });
  await using pty = await openPty({ binary: BINARY, cwd: service.cwd, env: service.env });

  await pty.waitFor((screen) => screen.text.includes("❯ Don't trust"));
  pty.press("picker.previous");
  await pty.waitFor((screen) => screen.text.includes("❯ Trust this folder"));
  pty.press("picker.accept");
  await ready(pty);
  pty.type("/qa-probe");
  await pty.waitFor((screen) => screen.text.includes("Show that the project plugin loaded"));
  pty.press("chat.submit");
  await pty.waitFor((screen) => screen.text.includes(PLUGIN_ANSWER));
}, 30_000);

test("the TUI keeps keys typed at launch, streams a reply, and prints the resume command on /quit and SIGTERM", async () => {
  await using service = await serveForBinary({ plugin: false });
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

test("closing the terminal ends the TUI within 2 s with 129", async () => {
  await using service = await serveForBinary({ plugin: false });
  await using pty = await openPty({ binary: BINARY, cwd: service.cwd, env: service.env });
  await ready(pty);

  const from = performance.now();
  pty.hangUp();
  const { status, elapsed } = await exitTimed(pty, from);

  expect(status).toBe(129);
  expect(elapsed).toBeLessThan(EXIT_BUDGET_MS);
}, 30_000);

test("SIGTERM to a TUI whose terminal already closed ends it within 2 s", async () => {
  await using service = await serveForBinary({ plugin: false });
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
  await using service = await serveForBinary({ plugin: false });
  service.reply({ content: [{ type: "text", text: "Answered before the hangup." }] });
  await using pty = await openPty({ binary: BINARY, cwd: service.cwd, env: service.env });
  await ready(pty);
  pty.type("hi nyte");
  pty.press("chat.submit");
  await pty.waitFor((screen) => screen.text.includes("Answered before the hangup."));

  const from = performance.now();
  pty.signal("SIGHUP");
  const { status, elapsed } = await exitTimed(pty, from);

  expect(status).toBe(129);
  expect(elapsed).toBeLessThan(EXIT_BUDGET_MS);
  expect(pty.output()).toMatch(RESUME);
}, 30_000);

test("nyte host serves clients that attach with --host-url from an empty HOME, and an attached TUI says when it stops", async () => {
  await using service = await serveForBinary({ plugin: false });
  await using client = await freshHome();
  service.reply(
    { content: [{ type: "text", text: "Printed by the attached host." }] },
    { content: [{ type: "text", text: "Rendered from the attached host." }] },
  );

  const host = Bun.spawn([BINARY, "host", "--json"], {
    cwd: service.cwd,
    env: { ...service.env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const reader = host.stdout.getReader();
  const decoder = new TextDecoder();
  let buffered = "";

  while (!buffered.includes("\n")) {
    const chunk = await reader.read();

    if (chunk.done) throw new Error(`nyte host closed stdout before listening: ${buffered}`);
    buffered += decoder.decode(chunk.value, { stream: true });
  }

  const listening = Value.Parse(Listening, JSON.parse(buffered.slice(0, buffered.indexOf("\n"))));
  const file = Value.Parse(HostFile, JSON.parse(await readFile(listening.endpoint, "utf8")));

  expect(file).toMatchObject({ url: listening.url, pid: host.pid });
  expect((await stat(listening.endpoint)).mode & 0o777).toBe(0o600);

  const second = Bun.spawn([BINARY, "host"], {
    env: { ...service.env },
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(await second.exited).toBe(1);
  expect(await new Response(second.stderr).text()).toContain(`already running at ${listening.url}`);

  const env = { ...client.env, NYTE_HOST_TOKEN: file.token };

  const printed = Bun.spawn([BINARY, "-p", "--json", "--host-url", listening.url, "print it"], {
    cwd: service.cwd,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(await printed.exited).toBe(0);
  expect(records(await new Response(printed.stdout).text()).at(-1)).toMatchObject({
    type: "result",
    kind: "completed",
  });

  await using pty = await openPty({
    binary: BINARY,
    args: ["--host-url", listening.url],
    cwd: service.cwd,
    env,
  });

  await ready(pty);
  pty.type("render it");
  pty.press("chat.submit");
  await pty.waitFor((screen) => screen.text.includes("Rendered from the attached host."));

  host.kill("SIGTERM");
  expect(await host.exited).toBe(0);
  expect(existsSync(listening.endpoint)).toBe(false);
  expect(await pty.exited()).toBe(1);
  expect(pty.output()).toContain(`The Nyte host at ${listening.url} stopped.`);
  expect(existsSync(join(client.nyteHome, "nyte.db"))).toBe(false);
}, 60_000);
