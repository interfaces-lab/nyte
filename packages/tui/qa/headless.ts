import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { Compile } from "typebox/compile";
import { createNyteClient, NyteWireError } from "@nyte-ai/client";
import { binaryDefines } from "../scripts/defines.ts";
import { DEFAULT_CONNECT_ORIGIN } from "../src/connect-config.ts";
import { deadline, session } from "./drive.ts";
import { startConnect } from "./account.ts";
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
          "--provider, --model and --effort choose the model and level; a completed run saves them",
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
            assert.equal(saved.payload.reasoning_effort, "high");
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

        await context.beat("serve --help needs no terminal and no provider", async () => {
          const help = await cli.run(["serve", "--help"]);

          assert.equal(help.code, 0, help.stderr);
          assert.ok(help.stdout.includes("Usage: nyte serve"));
          assert.ok(!help.stdout.includes("\x1b["));
        });

        await context.beat(
          "serve hosts a registered folder for a wire client, runs without a watcher, and stops on SIGTERM",
          async () => {
            provider.enqueue({
              name: "headless answer",
              action: { kind: "reply", text: "served" },
            });
            const pending = cli.start(["serve", "--workspace", workspace.cwd, "--port", "0"]);
            await waitForOutput(pending.run, (stdout) => /Bearer token: .+\n/u.test(stdout));
            const address = /API at (http:\/\/127\.0\.0\.1:\d+)\n/u.exec(pending.run.stdout)?.[1];
            const token = /Bearer token: (.+)\n/u.exec(pending.run.stdout)?.[1];
            assert.ok(address !== undefined && token !== undefined, pending.run.stdout);
            const client = createNyteClient({ baseUrl: address, token });
            const stranger = createNyteClient({
              baseUrl: address,
              token: "not-the-token-not-the-token",
            });

            const info = await client.info();
            assert.deepEqual(info.workspaces, { kind: "registry" });
            assert.ok(info.identity?.hostId);
            await assert.rejects(
              stranger.info(),
              (error: unknown) => error instanceof NyteWireError && error.code === "forbidden",
            );

            const [row] = await client.environment("environment.workspaces.list", undefined);
            assert.ok(row !== undefined && row.path === workspace.cwd, JSON.stringify(row));
            assert.equal(row?.trust.kind, "policy");
            await assert.rejects(
              client.sessions.create(),
              (error: unknown) => error instanceof NyteWireError && error.code === "forbidden",
            );

            const start = {
              requestId: "qa-start-1",
              workspace: { id: row.id },
              message: { content: "say served" },
            };
            const accepted = await client.environment("environment.start", start);
            assert.equal(accepted.kind, "accepted");
            assert.deepEqual(await client.environment("environment.start", start), accepted);

            if (accepted.kind !== "accepted") return;
            const until = deadline();

            for (;;) {
              const snapshot = await client.sessions.snapshot({ sessionId: accepted.sessionId });

              if (snapshot?.run?.phase.kind === "done") break;
              assert.ok(performance.now() < until, "the headless run did not finish");
              await Bun.sleep(25);
            }

            assert.equal(chat().at(-1)?.prompt, "say served");
            pending.signal("SIGTERM");
            const done = await pending.exit();
            assert.equal(done.code, 0, done.stderr);
          },
        );

        await context.beat(
          "serve starts without a provider credential and says what is blocked",
          async () => {
            const auth = join(workspace.env.NYTE_HOME, "auth.json");
            const saved = await readFile(auth, "utf8");
            await rm(auth);

            try {
              const pending = cli.start(["serve", "--workspace", workspace.cwd, "--port", "0"]);
              await waitForOutput(pending.run, (stdout) => /Bearer token: .+\n/u.test(stdout));
              assert.ok(
                pending.run.stdout.includes("No model provider is signed in on this host."),
              );
              const address = /API at (http:\/\/127\.0\.0\.1:\d+)\n/u.exec(pending.run.stdout)?.[1];
              const token = /Bearer token: (.+)\n/u.exec(pending.run.stdout)?.[1];
              assert.ok(address !== undefined && token !== undefined, pending.run.stdout);
              const client = createNyteClient({ baseUrl: address, token });
              assert.equal(
                (await client.environment("environment.workspaces.list", undefined)).length,
                1,
              );
              pending.signal("SIGTERM");
              const done = await pending.exit();
              assert.equal(done.code, 0, done.stderr);
            } finally {
              await writeFile(auth, saved, { mode: 0o600 });
            }
          },
        );
        await context.beat(
          "account commands refuse clearly without a link, and serve --account needs one",
          async () => {
            const help = await cli.run(["account", "--help"]);
            assert.equal(help.code, 0, help.stderr);
            assert.ok(help.stdout.includes("Usage: nyte account"));
            const status = await cli.run(["account", "status"]);
            assert.equal(status.code, 0, status.stderr);
            assert.ok(status.stdout.includes("Not linked to a Nyte account."), status.stdout);
            const unlinked = await cli.run(
              ["serve", "--workspace", workspace.cwd, "--account"],
              undefined,
              { NYTE_CONNECT_ORIGIN: "https://connect.invalid" },
            );
            assert.notEqual(unlinked.code, 0);
            assert.ok(unlinked.stderr.includes("isn't linked to a Nyte account"), unlinked.stderr);
            const unconfigured = await cli.run(["account", "login"], undefined, {
              NYTE_CONNECT_ORIGIN: "http://connect.invalid",
            });
            assert.notEqual(unconfigured.code, 0);
            assert.ok(unconfigured.stderr.includes("NYTE_CONNECT_ORIGIN"), unconfigured.stderr);
          },
        );

        await context.beat(
          "a binary built with NYTE_CONNECT_ORIGIN carries it; the running process's value still wins",
          async () => {
            // The same define map the real build uses, applied to the same module, compiled
            // the same way; only the entry is a probe that prints what the module reads.
            const probe = join(context.cwd, "connect-config-probe.ts");
            await writeFile(
              probe,
              [
                `import { readConnectConfig } from ${JSON.stringify(fileURLToPath(new URL("../src/connect-config.ts", import.meta.url)))};`,
                "console.log(JSON.stringify(readConnectConfig() ?? null));",
              ].join("\n"),
            );

            const compiled = async (built: string | undefined, runtime: string | undefined) => {
              const outfile = join(
                context.cwd,
                `connect-config-${built === undefined ? "bare" : "baked"}`,
              );
              const result = await Bun.build({
                entrypoints: [probe],
                target: "bun",
                define: binaryDefines(built === undefined ? {} : { NYTE_CONNECT_ORIGIN: built }),
                compile: { outfile, autoloadBunfig: false, autoloadDotenv: false },
              });
              assert.ok(result.success, result.logs.map((log) => log.message).join("\n"));
              const run = Bun.spawn([outfile], {
                env:
                  runtime === undefined
                    ? { PATH: process.env.PATH ?? "" }
                    : { PATH: process.env.PATH ?? "", NYTE_CONNECT_ORIGIN: runtime },
                stdout: "pipe",
                stderr: "pipe",
              });
              const [stdout, code] = await Promise.all([
                new Response(run.stdout).text(),
                run.exited,
              ]);
              assert.equal(code, 0, await new Response(run.stderr).text());

              const printed: unknown = JSON.parse(stdout.trim());

              return printed;
            };

            assert.deepEqual(await compiled("https://connect.qa.example", undefined), {
              origin: "https://connect.qa.example",
            });
            assert.deepEqual(
              await compiled("https://connect.qa.example", "https://runtime.qa.example"),
              {
                origin: "https://runtime.qa.example",
              },
            );
            assert.deepEqual(await compiled(undefined, undefined), {
              origin: DEFAULT_CONNECT_ORIGIN,
            });
          },
        );

        await context.beat(
          "account login links through Nyte Connect over verified HTTPS, serve --account answers a browser device through the relay, and unlink removes the host",
          async () => {
            const connect = await startConnect();
            const forgetConnect = context.defer(() => connect.close());

            try {
              const env = {
                NYTE_CONNECT_ORIGIN: connect.origin,
                NODE_EXTRA_CA_CERTS: connect.caPath,
              };
              // Without this run's CA the binary refuses the certificate: nothing here turns TLS checks off.
              const untrusted = await cli.run(
                ["account", "login", "--name", "QA runner"],
                undefined,
                {
                  NYTE_CONNECT_ORIGIN: connect.origin,
                },
              );
              assert.notEqual(untrusted.code, 0);
              assert.ok(untrusted.stderr.includes("Couldn't reach Nyte Connect"), untrusted.stderr);
              assert.deepEqual(await connect.query("SELECT id FROM link_transactions"), []);
              const login = cli.start(["account", "login", "--name", "QA runner"], undefined, env);
              await waitForOutput(login.run, (stdout) => stdout.includes("Compare  fingerprint"));
              const userCode = /Code {5}(\S+)\n/u.exec(login.run.stdout)?.[1];
              const fingerprint = /Compare {2}fingerprint (\S+)\n/u.exec(login.run.stdout)?.[1];
              assert.ok(userCode !== undefined && fingerprint !== undefined, login.run.stdout);
              assert.ok(login.run.stdout.includes("/link\n"), login.run.stdout);
              const lookup = await connect.approve(userCode, fingerprint);
              assert.equal(lookup.hostName, "QA runner");
              const linked = await login.exit();
              assert.equal(linked.code, 0, linked.stderr);
              assert.ok(
                linked.stdout.includes(`Host linked to ${connect.owner.email} as "QA runner".`),
                linked.stdout,
              );

              const status = await cli.run(["account", "status"], undefined, env);
              assert.equal(status.code, 0, status.stderr);
              assert.ok(
                status.stdout.includes(
                  `Linked to ${connect.owner.email} as "QA runner" through ${connect.origin}`,
                ),
                status.stdout,
              );

              provider.enqueue({
                name: "relayed answer",
                action: { kind: "reply", text: "relayed" },
              });
              const serving = cli.start(
                ["serve", "--workspace", workspace.cwd, "--port", "0", "--account"],
                undefined,
                env,
              );
              await waitForOutput(serving.run, (stdout) =>
                stdout.includes("Account sharing: relay connected, lease current"),
              );
              const hostId = /Host (\S+) \(profile default\)\n/u.exec(serving.run.stdout)?.[1];
              const environmentId = new RegExp(
                `at ${connect.origin.replaceAll(".", "\\.")}/r/([0-9a-f-]+)\n`,
                "u",
              ).exec(serving.run.stdout)?.[1];
              assert.ok(hostId !== undefined && environmentId !== undefined, serving.run.stdout);

              const browser = await connect.enroll(environmentId);
              const until = deadline();
              let reached = await browser.info().catch(() => undefined);

              while (reached === undefined) {
                assert.ok(
                  performance.now() < until,
                  `The relay never admitted the device:\n${serving.run.stdout}${serving.run.stderr}`,
                );
                await Bun.sleep(100);
                reached = await browser.info().catch(() => undefined);
              }

              assert.equal(reached.identity?.hostId, hostId);
              assert.deepEqual(reached.workspaces, { kind: "registry" });
              const [row] = await browser.environment("environment.workspaces.list", undefined);
              assert.ok(row !== undefined && row.path === workspace.cwd, JSON.stringify(row));
              await assert.rejects(
                browser.environment("environment.workspaces.register", { path: context.cwd }),
                (error: unknown) => error instanceof NyteWireError && error.code === "forbidden",
              );
              const accepted = await browser.environment("environment.start", {
                requestId: "qa-relay-start-1",
                workspace: { id: row.id },
                message: { content: "say relayed" },
              });
              assert.equal(accepted.kind, "accepted");

              if (accepted.kind !== "accepted") return;

              for (;;) {
                const snapshot = await browser.sessions.snapshot({ sessionId: accepted.sessionId });

                if (snapshot?.run?.phase.kind === "done") break;
                assert.ok(performance.now() < until, "the relayed run did not finish");
                await Bun.sleep(50);
              }

              assert.equal(chat().at(-1)?.prompt, "say relayed");
              serving.signal("SIGTERM");
              const stopped = await serving.exit();
              assert.equal(stopped.code, 0, stopped.stderr);

              const unlinked = await cli.run(["account", "unlink"], undefined, env);
              assert.equal(unlinked.code, 0, unlinked.stderr);
              assert.ok(
                unlinked.stdout.includes(`Unlinked from ${connect.owner.email}.`),
                unlinked.stdout,
              );
              assert.deepEqual(await connect.query("SELECT state FROM environments"), [
                { state: "revoked" },
              ]);
            } finally {
              await connect.close();
              forgetConnect();
            }
          },
        );
      } finally {
        await cli.stop();
        forget();
        await writeFile(join(context.cwd, "cli.json"), JSON.stringify(cli.runs, null, 2));
      }
    }),
};
