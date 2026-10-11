import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import { Compile } from "typebox/compile";
import { deadline, session } from "./drive.ts";
import { bashRequest, TITLE_SCRIPT } from "./provider.ts";
import { FIXTURE_CHILD_MODEL, FIXTURE_MODEL, FIXTURE_PROVIDER } from "./workspace.ts";
import type { Workspace } from "./workspace.ts";
import type { Scenario } from "./types.ts";

/** The `-p --json` stdout contract: one JSON record per line, ending with the result. */
const printRecord = Compile(
  Type.Union([
    Type.Object({ type: Type.Literal("text"), text: Type.String() }),
    Type.Object({ type: Type.Literal("tool"), name: Type.String() }),
    Type.Object({
      type: Type.Literal("result"),
      kind: Type.String(),
      code: Type.String(),
      session: Type.Optional(Type.String()),
      message: Type.Optional(Type.String()),
      signal: Type.Optional(Type.String()),
      next: Type.Optional(Type.Object({ argv: Type.Array(Type.String()), command: Type.String() })),
    }),
  ]),
);

type CliRun = {
  readonly args: readonly string[];
  readonly stdin: string | undefined;
  stdout: string;
  stderr: string;
  code: number | undefined;
};

/** Every stdout line parsed against the contract; the last one is the result. */
function records(stdout: string) {
  const lines = stdout.split("\n").filter((line) => line !== "");

  const parsed = lines.map((line) => {
    const value: unknown = JSON.parse(line);

    assert.ok(printRecord.Check(value), `stdout line is a print record: ${line}`);

    return value;
  });

  const result = parsed.at(-1);
  assert.ok(result?.type === "result", "stdout ends with the result record");

  return {
    text: parsed.flatMap((record) => (record.type === "text" ? [record.text] : [])).join(""),
    tools: parsed.flatMap((record) => (record.type === "tool" ? [record.name] : [])),
    result,
  };
}

/** Ends a launched binary's process group; a group that already ended is not an error. */
function killGroup(pid: number) {
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
  }
}

/** The compiled binary with pipes for stdin, stdout and stderr: no terminal anywhere. */
function launcher(binary: string, workspace: Workspace) {
  const runs: CliRun[] = [];
  const live = new Set<{ readonly finish: () => Promise<void> }>();

  const start = (args: readonly string[], stdin?: string, env: Record<string, string> = {}) => {
    const run: CliRun = { args, stdin, stdout: "", stderr: "", code: undefined };
    runs.push(run);

    const child = Bun.spawn([binary, ...args], {
      cwd: workspace.cwd,
      env: { ...workspace.env, ...env },
      stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
      stdout: "pipe",
      stderr: "pipe",
      // Its own process group, so a failed step can stop everything the binary started.
      detached: true,
    });

    const readers = [child.stdout.getReader(), child.stderr.getReader()];

    const collect = async (reader: (typeof readers)[number], key: "stdout" | "stderr") => {
      const decoder = new TextDecoder();

      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read())
        run[key] += decoder.decode(chunk.value, { stream: true });
      run[key] += decoder.decode();
    };

    // A tool the binary started can hold the pipes open after the binary exits.
    const settled = Promise.all([
      child.exited,
      collect(readers[0], "stdout"),
      collect(readers[1], "stderr"),
    ]).then(([code]) => {
      run.code = code;
    });

    /** Kills the group, then stops reading pipes that a process outside it still holds. */
    const finish = async () => {
      killGroup(child.pid);
      const grace = Promise.withResolvers<void>();
      const timer = globalThis.setTimeout(grace.resolve, 2_000);

      try {
        await Promise.race([settled, grace.promise]);
      } finally {
        clearTimeout(timer);
      }

      await Promise.all(readers.map((reader) => reader.cancel()));
      await child.exited;
    };

    const handle = { finish };
    live.add(handle);
    void settled.finally(() => live.delete(handle)).catch(() => {});

    return {
      run,
      signal: (name: "SIGTERM") => child.kill(name),
      async exit() {
        const timeout = Promise.withResolvers<"timeout">();

        const timer = globalThis.setTimeout(
          () => timeout.resolve("timeout"),
          Math.max(0, deadline() - performance.now()),
        );

        try {
          if ((await Promise.race([settled, timeout.promise])) === "timeout") {
            await finish();
            throw new Error(
              `nyte ${args.join(" ")} did not finish before the deadline:\n${run.stdout}${run.stderr}`,
            );
          }
        } finally {
          clearTimeout(timer);
        }

        return run;
      },
    };
  };

  return {
    runs,
    start,
    run: (args: readonly string[], stdin?: string, env?: Record<string, string>) =>
      start(args, stdin, env).exit(),
    stop: () => Promise.all([...live].map((handle) => handle.finish())),
  };
}

/** Polls the growing stdout; with the provider holding its stream, text here precedes completion. */
async function waitForOutput(run: CliRun, predicate: (stdout: string) => boolean) {
  const until = deadline();

  while (!predicate(run.stdout)) {
    assert.ok(run.code === undefined, `The binary exited first:\n${run.stdout}${run.stderr}`);
    assert.ok(performance.now() < until, `Timed out waiting for stdout:\n${run.stdout}`);
    await Bun.sleep(10);
  }
}

export const headless: Scenario = {
  name: "headless",
  run: (context) =>
    session(context, {}, async ({ provider, workspace, tool }) => {
      const cli = launcher(context.binary.path, workspace);

      const forget = context.defer(async () => {
        await cli.stop();
      });

      const chat = () => provider.requests.filter((request) => request.script !== TITLE_SCRIPT);
      let sessionId = "";

      try {
        await context.beat("--help prints plain usage on stdout and exits 0", async () => {
          const help = await cli.run(["--help"]);

          assert.equal(help.code, 0);
          assert.equal(help.stderr, "");
          assert.ok(help.stdout.includes("nyte -p [--json] [--quiet] [--resume] [prompt]"));
          assert.ok(help.stdout.includes("--session <session-id>"));
          assert.ok(!help.stdout.includes("\x1b["), "Piped help has no color codes");
        });

        await context.beat(
          "-p --json streams reply text before the provider finishes, then a completed result",
          async () => {
            provider.enqueue({
              name: "streamed answer",
              prompt: "what is nyte",
              action: { kind: "hold", text: "Nyte is a terminal", tail: " coding agent." },
            });
            const pending = cli.start(["-p", "--json", "what is nyte"]);

            const request = await provider.waitForRequest(
              (item) => item.script === "streamed answer",
            );

            await provider.waitForStage(request.id, "held");
            await waitForOutput(pending.run, (stdout) => stdout.includes('"type":"text"'));
            provider.release(request.id);
            const done = await pending.exit();
            const output = records(done.stdout);

            assert.equal(done.code, 0, done.stderr);
            assert.equal(output.text, "Nyte is a terminal coding agent.");
            assert.equal(output.result.kind, "completed");
            assert.equal(output.result.code, "completed");
            assert.ok(output.result.session, "The result names the session");
            sessionId = output.result.session;
            assert.equal(output.result.next?.command, `nyte --session=${sessionId}`);
            assert.equal(request.model, FIXTURE_MODEL);
            assert.equal(request.prompt, "what is nyte");
          },
        );

        await context.beat(
          "piped stdin runs a bash tool; the answer goes to stdout, tool and outcome to stderr",
          async () => {
            provider.enqueue(
              { ...bashRequest("seq 1 3"), prompt: "count to three" },
              {
                name: "counted",
                prompt: "count to three",
                action: { kind: "reply", text: "Counted to three." },
              },
            );
            const done = await cli.run(["-p"], "count to three\n");

            assert.equal(done.code, 0, done.stderr);
            assert.equal(done.stdout, "Counted to three.\n");
            const lines = done.stderr.split("\n");
            assert.ok(lines.includes("bash"), done.stderr);
            const id = /^session (\S+) · completed$/mu.exec(done.stderr)?.[1];
            assert.ok(id, done.stderr);
            assert.ok(lines.includes(`open in a terminal: nyte --session=${id}`), done.stderr);
            assert.notEqual(id, sessionId, "A new print run opens a new session");

            const continuation = await provider.waitForRequest((item) => item.script === "counted");

            assert.ok(
              continuation.payload.messages.some(
                (message) =>
                  message.role === "tool" && JSON.stringify(message.content).includes("1\\n2\\n3"),
              ),
              "The real command's output reaches the provider as the tool result",
            );
          },
        );

        await context.beat("-p --session continues the earlier conversation", async () => {
          provider.enqueue({
            name: "follow-up",
            prompt: "and what else",
            action: { kind: "reply", text: "It also resumes sessions." },
          });
          const before = chat().length;
          const done = await cli.run(["-p", "--json", "--session", sessionId, "and what else"]);
          const output = records(done.stdout);

          assert.equal(done.code, 0, done.stderr);
          assert.equal(output.text, "It also resumes sessions.");
          assert.equal(output.result.session, sessionId);
          const request = await provider.waitForRequest((item) => item.script === "follow-up");
          const history = JSON.stringify(request.payload.messages);
          assert.ok(history.includes("what is nyte"), "The first prompt is in the history");
          assert.ok(history.includes("Nyte is a terminal coding agent."));
          assert.equal(chat().length, before + 1, "Resuming replays no earlier request");
        });

        await context.beat(
          "--provider, --model and --effort choose the model and level; the model becomes the default, the level stays with its run",
          async () => {
            provider.enqueue({
              name: "chosen model",
              model: FIXTURE_CHILD_MODEL,
              prompt: "use the child model",
              action: { kind: "reply", text: "Child model answered." },
            });

            const done = await cli.run([
              "-p",
              "--json",
              "--provider",
              FIXTURE_PROVIDER,
              "--model",
              FIXTURE_CHILD_MODEL,
              "--effort",
              "high",
              "use the child model",
            ]);

            assert.equal(done.code, 0, done.stderr);
            assert.equal(records(done.stdout).text, "Child model answered.");
            const request = await provider.waitForRequest((item) => item.script === "chosen model");
            assert.equal(request.model, FIXTURE_CHILD_MODEL);
            assert.equal(request.payload.reasoning_effort, "high");

            provider.enqueue({
              name: "saved defaults",
              model: FIXTURE_CHILD_MODEL,
              prompt: "no flags this time",
              action: { kind: "reply", text: "Saved defaults answered." },
            });
            const next = await cli.run(["-p", "--json", "no flags this time"]);

            assert.equal(next.code, 0, next.stderr);
            const saved = await provider.waitForRequest((item) => item.script === "saved defaults");
            assert.equal(saved.model, FIXTURE_CHILD_MODEL);
            assert.notEqual(saved.payload.reasoning_effort, "high", "--effort is per run");
          },
        );

        await context.beat("a provider error exits 1 with a failed result", async () => {
          provider.enqueue({
            name: "provider failure",
            prompt: "this request fails",
            action: { kind: "fail", status: 400, message: "QA provider failure" },
          });
          const done = await cli.run(["-p", "--json", "this request fails"]);
          const output = records(done.stdout);

          assert.equal(done.code, 1, done.stderr);
          assert.equal(output.text, "");
          assert.equal(output.result.kind, "failed");
          assert.ok(output.result.message?.includes("QA provider failure"), done.stdout);
        });

        await context.beat(
          "SIGTERM during a running tool exits 143, reports cancelled and ends the tool",
          async () => {
            const work = await tool("print-heartbeat");
            provider.enqueue({
              ...bashRequest(work.command),
              model: FIXTURE_CHILD_MODEL,
              prompt: "run the heartbeat",
            });
            const pending = cli.start(["-p", "--json", "run the heartbeat"]);
            await work.alive();
            pending.signal("SIGTERM");
            const done = await pending.exit();
            const output = records(done.stdout);

            assert.equal(done.code, 143, done.stderr);
            assert.equal(output.result.kind, "cancelled");
            assert.equal(output.result.signal, "SIGTERM");
            // Checked before any QA cleanup runs, so cleanup cannot make this pass.
            await work.stopped(true);
          },
        );
      } finally {
        await cli.stop();
        forget();
        await writeFile(join(context.cwd, "cli.json"), JSON.stringify(cli.runs, null, 2));
      }
    }),
};
