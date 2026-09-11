import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { stripVTControlCharacters } from "node:util";
import type { ChatCommand } from "../src/constants.ts";
import { openProvider } from "./provider.ts";
import type { ProviderController, ProviderStep } from "./provider.ts";
import { createWorkspace } from "./workspace.ts";
import type { Workspace } from "./workspace.ts";
import type { ScenarioContext, Screen, Terminal } from "./types.ts";

export const deadline = () => performance.now() + 15_000;

/** A fully painted composer row: a frame captured mid-repaint can show the prompt over another row. */
export const composer = (screen: Screen, text: string) =>
  screen.lines.some(
    (line) => line.trimStart().startsWith(`│ ❯ ${text}`) && line.trimEnd().endsWith("│"),
  );

export const ready = (screen: Screen) =>
  screen.text.includes("nyte-qa") &&
  screen.text.includes("enter send") &&
  !screen.text.includes("Loading") &&
  !screen.text.includes("Checking workspace");

/** The status line under the composer names the active model and thinking level. */
export const footer = (screen: Screen, model: string, level: string) =>
  screen.lines.some(
    (line) =>
      line.includes("╰") &&
      line.includes(`│ ${model} │`) &&
      new RegExp(`\\b${level}\\b`, "u").test(line),
  );

/** A failing step names the beat a person was in, not just the assertion. */
export async function beat(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (cause) {
    const detail = cause instanceof Error ? (cause.stack ?? cause.message) : String(cause);
    throw new Error(`Beat "${name}": ${detail}`, { cause });
  }
}

export async function press(
  terminal: Terminal,
  action: ChatCommand,
  predicate: (screen: Screen) => boolean,
): Promise<Screen> {
  const input = terminal.key(action);
  return terminal.waitForScreen(predicate, deadline(), input);
}

/** Every typed grapheme has its own input-to-visible observation. */
export async function type(
  terminal: Terminal,
  text: string,
  options: { prefix?: string; label?: string } = {},
): Promise<void> {
  let expected = options.prefix ?? "";
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
    text,
  )) {
    expected += segment;
    const input =
      options.label === undefined ? terminal.text(segment) : terminal.raw(segment, options.label);
    await terminal.waitForScreen(
      (screen) =>
        composer(screen, expected) &&
        (segment.trim() !== "" ||
          screen.cursor.x !== input.before.cursor.x ||
          screen.cursor.y !== input.before.cursor.y),
      deadline(),
      input,
    );
  }
}

export async function command(
  terminal: Terminal,
  name: string,
  predicate: (screen: Screen) => boolean,
): Promise<Screen> {
  await type(terminal, `/${name}`);
  return press(terminal, "chat.submit", predicate);
}

/** The PTY output after exit, with escape sequences removed. */
export function output(terminal: Terminal): string {
  return stripVTControlCharacters(
    Buffer.concat(terminal.chunks.map((chunk) => Buffer.from(chunk.base64, "base64"))).toString(),
  ).replaceAll("\r", "");
}

/** Waits for the two-line resume output and returns the session id it names. */
export async function resumeSession(terminal: Terminal, expectedCode: number): Promise<string> {
  await terminal.waitForScreen(
    (screen) => screen.text.includes("To resume previous session"),
    deadline(),
  );
  assert.equal(await terminal.waitForExit(deadline()), expectedCode);
  // A --show run shares the real stdin; the next open needs this renderer released.
  await terminal.close();
  const match = /(?:^|\n)To resume previous session\nnyte --session=([^\n]+)\n$/u.exec(
    output(terminal),
  );
  assert.ok(match?.[1], "Exit ends with the public two-line resume command");
  return match[1];
}

export async function quit(terminal: Terminal): Promise<string> {
  await type(terminal, "/quit");
  terminal.key("chat.submit");
  return resumeSession(terminal, 0);
}

async function file(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
    throw error;
  }
}

async function outcome(description: string, predicate: () => Promise<boolean>) {
  const until = deadline();
  while (!(await predicate())) {
    assert.ok(performance.now() < until, `Timed out: ${description}`);
    // Poll external process evidence, not elapsed time as a completion assertion.
    await setTimeout(20);
  }
}

/** A real bash process run by the production tool; its files and PID are the evidence. */
export async function heartbeat(workspace: Workspace, name: string) {
  const evidence = join(workspace.cwd, name, "evidence");
  await mkdir(evidence, { recursive: true });
  const snapshot = async () => {
    const pid = await file(join(evidence, "pid"));
    let process = "not started";
    if (pid !== "") {
      assert.match(pid, /^[1-9]\d*\n$/u, "Parse the fixture's PID before passing it to ps");
      const status = Bun.spawnSync(["/bin/ps", "-p", pid.trim(), "-o", "pid=,stat="], {
        env: workspace.env,
        stdout: "pipe",
        stderr: "pipe",
      });
      assert.ok(
        status.exitCode === 0 || status.exitCode === 1,
        "ps must succeed or report no process",
      );
      assert.equal(status.stderr.toString(), "");
      process = status.stdout.toString().trim();
      assert.ok(process === "" || /^\d+\s+\S+$/u.test(process), "Parse ps output");
    }
    return {
      pid,
      process,
      lifetime: await file(join(evidence, "lifetime")),
      heartbeat: await file(join(evidence, "heartbeat")),
    };
  };
  return {
    name,
    // Each invocation uses the unchanged public script with its own working directory.
    command: `cd ${name} && /bin/bash ../heartbeat.sh`,
    snapshot,
    release: () => writeFile(join(evidence, "release"), "release\n"),
    async alive() {
      await outcome(`${name} starts`, async () =>
        (await snapshot()).lifetime.includes("started\n"),
      );
      const before = await snapshot();
      await outcome(`${name} produces another heartbeat`, async () => {
        const current = await snapshot();
        assert.ok(!current.lifetime.includes("exited"), `${name} exited instead of staying alive`);
        return current.heartbeat.length >= before.heartbeat.length + "heartbeat\n".length * 3;
      });
      assert.notEqual((await snapshot()).process, "", `${name} process is still present`);
    },
    async stopped(cancelled: boolean) {
      // Cancellation may use SIGKILL, which cannot run the script's EXIT trap.
      // OS process disappearance proves termination without requiring a particular signal.
      await outcome(`${name} process disappears`, async () => (await snapshot()).process === "");
      const before = await snapshot();
      assert.equal(before.lifetime.includes("released\n"), !cancelled);
      if (!cancelled) assert.ok(before.lifetime.includes("exited\n"));
      // Sample across several 100ms heartbeat periods as an extra check that a
      // writer did not survive the original process. Time alone never proves exit.
      const until = performance.now() + 400;
      do {
        await setTimeout(40);
        assert.equal((await snapshot()).heartbeat, before.heartbeat, `${name} wrote after exit`);
      } while (performance.now() < until);
    },
  };
}

export type Heartbeat = Awaited<ReturnType<typeof heartbeat>>;

export type Session = {
  terminal: Terminal;
  provider: ProviderController;
  workspace: Workspace;
  /** Launches another binary against the same workspace and provider. */
  reopen: (args?: string[]) => Promise<Terminal>;
  tool: (name: string) => Promise<Heartbeat>;
};

/** One provider, one workspace, any number of binary launches; evidence is written on the way out. */
export async function session(
  context: ScenarioContext,
  options: {
    steps?: readonly ProviderStep[];
    trusted?: boolean;
    question?: boolean;
    reasoning?: boolean;
    height?: number;
  },
  run: (session: Session) => Promise<void>,
): Promise<void> {
  const provider = await openProvider(options.steps);
  const terminals: Terminal[] = [];
  const tools: Heartbeat[] = [];
  let workspace: Workspace | undefined;
  try {
    const isolated = await createWorkspace({
      baseUrl: provider.baseUrl,
      trusted: options.trusted,
      question: options.question,
      reasoning: options.reasoning,
    });
    workspace = isolated;
    const reopen = async (args: string[] = []) => {
      const terminal = await context.open({
        cwd: isolated.cwd,
        env: isolated.env,
        args,
        ...(options.height === undefined ? {} : { height: options.height }),
      });
      terminals.push(terminal);
      return terminal;
    };
    const terminal = await reopen();
    await run({
      terminal,
      provider,
      workspace: isolated,
      reopen,
      async tool(name) {
        const tool = await heartbeat(isolated, name);
        tools.push(tool);
        return tool;
      },
    });
    // Bash rendering can request a syntax asset. The fixture denies this CONNECT
    // without contacting GitHub; preserve that denial in evidence, not as a failure.
    assert.deepEqual(
      provider.errors.filter((error) => error !== "Blocked CONNECT github.com:443"),
      [],
      "Only scripted loopback provider requests are allowed",
    );
  } finally {
    try {
      // Capture before cleanup releases tools, so cleanup cannot make cancellation pass.
      await writeFile(
        join(context.cwd, "provider.json"),
        JSON.stringify(
          {
            requests: provider.requests,
            events: provider.events,
            errors: provider.errors,
            tools: await Promise.all(
              tools.map(async (tool) => ({ name: tool.name, ...(await tool.snapshot()) })),
            ),
          },
          null,
          2,
        ),
      );
    } finally {
      try {
        await Promise.all(tools.map((tool) => tool.release()));
      } finally {
        try {
          for (const terminal of terminals) await terminal.close();
          await Promise.all(
            tools.map((tool) =>
              outcome(`${tool.name} cleanup`, async () => {
                const state = await tool.snapshot();
                return state.process === "" || state.process === "not started";
              }),
            ),
          );
        } finally {
          try {
            await provider.close();
          } finally {
            await workspace?.close();
          }
        }
      }
    }
  }
}
