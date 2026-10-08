import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { WORKSPACE_TRUST_TITLE } from "../src/constants.ts";
import {
  command,
  composer,
  deadline,
  footer,
  press,
  quit,
  ready,
  resumeSession,
  session,
  type,
} from "./drive.ts";
import { bashRequest, TITLE_SCRIPT } from "./provider.ts";
import {
  FIXTURE_CHILD_MODEL,
  FIXTURE_MODEL,
  FIXTURE_PROVIDER,
  PLUGIN_EVIDENCE,
} from "./workspace.ts";
import type { Scenario, Screen } from "./types.ts";

/**
 * A bash card asks GitHub for the bash grammar (src/syntax-parsers.ts). The loopback proxy
 * refuses it, so nothing is downloaded and the card stays plain.
 */
const GRAMMAR_FETCHES = [
  "Blocked CONNECT github.com:443",
  "Blocked CONNECT raw.githubusercontent.com:443",
];

const idle = (screen: Screen) => screen.text.includes("enter send");

const emptyComposer = (screen: Screen) => composer(screen, "Plan, search, build anything");

/** Footer rows: the composer's bottom border names the model. */
const footers = (screen: Screen) =>
  screen.lines.filter((line) => line.includes("╰") && line.includes("nyte-qa")).length;

const longList = Array.from(
  { length: 150 },
  (_, index) => `list-row-${String(index).padStart(3, "0")}`,
).join("\n");

/** The screen row that shows a list entry, or -1. */
const rowOf = (screen: Screen, entry: string) =>
  screen.lines.findIndex((line) => line.includes(entry));

export const tui: Scenario = {
  name: "tui",
  localInputs: ["text.idle"],
  run: (context) =>
    session(
      context,
      { plugin: true, refused: GRAMMAR_FETCHES },
      async ({ provider, workspace, open, tool }) => {
        const chat = () => provider.requests.filter((request) => request.script !== TITLE_SCRIPT);

        const pluginSetups = async () =>
          (await readFile(join(workspace.cwd, PLUGIN_EVIDENCE), "utf8").catch(() => ""))
            .split("\n")
            .filter(Boolean).length;

        provider.enqueue(
          {
            name: "greeting",
            prompt: "hi nyte",
            action: {
              kind: "hold",
              text: "Hello from the loopback provider.",
              tail: " Ready when you are.",
            },
          },
          {
            name: "long list",
            prompt: "print the long list",
            action: { kind: "reply", text: longList },
          },
          {
            name: "chosen model",
            model: FIXTURE_CHILD_MODEL,
            prompt: "which model is this",
            action: { kind: "reply", text: "The child model answered." },
          },
          {
            name: "after restart",
            model: FIXTURE_CHILD_MODEL,
            prompt: "after the restart",
            action: { kind: "reply", text: "Still the child model." },
          },
        );

        let terminal = await open();

        await context.beat(
          "a project plugin waits behind workspace trust; Enter quits and the next launch asks again",
          async () => {
            await terminal.waitForScreen(
              (screen) =>
                screen.text.includes(WORKSPACE_TRUST_TITLE) && screen.text.includes("▸ [q] Quit"),
              deadline(),
            );
            assert.equal(await pluginSetups(), 0, "No project code runs before trust");
            await press(
              terminal,
              "workspace.accept",
              (screen) => !screen.text.includes(WORKSPACE_TRUST_TITLE),
            );
            assert.equal(await terminal.waitForExit(deadline()), 0);
            await terminal.close();
            assert.equal(await pluginSetups(), 0, "Declining trust runs no project code");
            assert.equal(provider.requests.length, 0, "Declining trust contacts no provider");
            terminal = await open();
            await terminal.waitForScreen(
              (screen) => screen.text.includes(WORKSPACE_TRUST_TITLE),
              deadline(),
            );
          },
        );

        await context.beat(
          "trusting the workspace loads the project plugin's command",
          async () => {
            await press(terminal, "workspace.toggle", (screen) =>
              screen.text.includes("▸ [a] Trust this workspace"),
            );
            await press(
              terminal,
              "workspace.accept",
              (screen) => ready(screen) && footer(screen, FIXTURE_MODEL, "off"),
            );
            await command(terminal, "qa-probe", (screen) =>
              screen.text.includes("QA plugin answered"),
            );
            assert.ok((await pluginSetups()) > 0, "The trusted plugin ran its setup");
          },
        );

        await context.beat(
          "typed keys echo at once; the reply streams in before the provider finishes",
          async () => {
            await type(terminal, "hi nyte", { label: "text.idle" });
            await press(
              terminal,
              "chat.submit",
              (screen) => screen.text.includes("hi nyte") && !composer(screen, "hi nyte"),
            );
            const request = await provider.waitForRequest((item) => item.script === "greeting");
            await provider.waitForStage(request.id, "held");
            await terminal.waitForScreen(
              (screen) => screen.text.includes("Hello from the loopback provider."),
              deadline(),
            );
            assert.ok(!terminal.screen().text.includes("Ready when you are."));
            provider.release(request.id);
            await terminal.waitForScreen(
              (screen) => screen.text.includes("Ready when you are.") && idle(screen),
              deadline(),
            );
            assert.equal(request.prompt, "hi nyte");
            assert.equal(request.model, FIXTURE_MODEL);
          },
        );

        await context.beat(
          "Esc stops a run while its bash tool streams; the process ends and the draft stays",
          async () => {
            const work = await tool("stopped-heartbeat");
            provider.enqueue({ ...bashRequest(work.command), prompt: "run the heartbeat" });
            await type(terminal, "run the heartbeat");
            await press(terminal, "chat.submit", (screen) =>
              screen.text.includes("QA tool heartbeat"),
            );
            await work.alive();
            await type(terminal, "keep this draft");
            await press(
              terminal,
              "chat.interrupt",
              (screen) => idle(screen) && composer(screen, "keep this draft"),
            );
            await work.stopped(true);
            assert.deepEqual(
              chat().map((request) => request.script),
              ["greeting", "bash"],
              "A stopped run asks the provider for nothing more",
            );
            await press(terminal, "chat.quit", emptyComposer);
          },
        );

        await context.beat(
          "a long reply pages up to its first row; the wheel moves three rows; Ctrl+End returns",
          async () => {
            await type(terminal, "print the long list");
            await press(
              terminal,
              "chat.submit",
              (screen) => screen.text.includes("list-row-149") && idle(screen),
            );

            for (let presses = 0; !terminal.screen().text.includes("list-row-000"); presses++) {
              assert.ok(presses < 30, "The first row is reachable by paging");
              const before = terminal.screen().text;
              await press(
                terminal,
                "chat.scroll.page.up",
                (screen) => screen.text !== before && screen.text.includes("ctrl+end latest"),
              );
            }

            const top = terminal.screen();
            const anchor = rowOf(top, "list-row-010");
            assert.ok(anchor > 3, "A list row below the top is the wheel's anchor");

            const wheel = terminal.mouse({
              type: "scroll",
              button: 5,
              x: 10,
              y: 10,
              modifiers: { shift: false, alt: false, ctrl: false },
              scroll: { direction: "down", delta: 1 },
            });

            const moved = await terminal.waitForScreen(
              (screen) => screen.text !== top.text,
              deadline(),
              wheel,
            );

            assert.equal(
              rowOf(moved, "list-row-010"),
              anchor - 3,
              "One wheel step moves three rows",
            );
            await press(
              terminal,
              "chat.scroll.latest",
              (screen) =>
                screen.text.includes("list-row-149") && !screen.text.includes("ctrl+end latest"),
            );
          },
        );

        await context.beat(
          "resizing narrow and back keeps the draft, cursor and one footer",
          async () => {
            const draft = "resize keeps this";
            await type(terminal, draft);

            for (const [width, height] of [
              [64, 20],
              [100, 32],
            ] as const) {
              const input = terminal.resize(width, height);

              const shown = await terminal.waitForScreen(
                (screen) =>
                  screen.columns === width &&
                  screen.rows === height &&
                  composer(screen, draft) &&
                  ready(screen),
                deadline(),
                input,
              );

              assert.equal(footers(shown), 1, "One composer footer after resize");
              const row = shown.lines.findIndex((line) => line.includes(`❯ ${draft}`));
              assert.equal(shown.cursor.y, row);
              assert.equal(shown.cursor.x, (shown.lines[row] ?? "").indexOf(draft) + draft.length);
            }

            await press(terminal, "chat.quit", emptyComposer);
          },
        );

        await context.beat(
          "the model picker and Shift+Tab choose the next request's model and thinking level",
          async () => {
            const requests = provider.requests.length;
            await command(
              terminal,
              "model",
              (screen) =>
                screen.text.includes("Type to search") &&
                screen.text.includes(`${FIXTURE_PROVIDER}/${FIXTURE_MODEL} · Off`),
            );
            await press(terminal, "model.next", (screen) =>
              screen.text.includes(`${FIXTURE_PROVIDER}/${FIXTURE_CHILD_MODEL} · Off`),
            );
            await press(
              terminal,
              "picker.accept",
              (screen) =>
                !screen.text.includes("Type to search") &&
                footer(screen, FIXTURE_CHILD_MODEL, "off"),
            );
            await press(terminal, "chat.thinking.cycle", (screen) =>
              footer(screen, FIXTURE_CHILD_MODEL, "minimal"),
            );
            assert.equal(provider.requests.length, requests, "Choosing sends nothing");
            await type(terminal, "which model is this");
            await press(
              terminal,
              "chat.submit",
              (screen) => screen.text.includes("The child model answered.") && idle(screen),
            );
            const request = await provider.waitForRequest((item) => item.script === "chosen model");
            assert.equal(request.model, FIXTURE_CHILD_MODEL);
            assert.equal(request.payload.reasoning_effort, "minimal");
          },
        );

        await context.beat(
          "a run keeps its thinking level while Shift+Tab sets the next; a queued follow-up gets it",
          async () => {
            const work = await tool("effort-heartbeat");
            provider.enqueue(
              { ...bashRequest(work.command), model: FIXTURE_CHILD_MODEL, prompt: "keep working" },
              {
                name: "continuation",
                model: FIXTURE_CHILD_MODEL,
                prompt: "keep working",
                action: { kind: "hold", text: "The original run continues" },
              },
              {
                name: "queued follow-up",
                model: FIXTURE_CHILD_MODEL,
                prompt: "queued follow-up",
                action: { kind: "reply", text: "The queued follow-up arrived." },
              },
            );
            await command(terminal, "effort low", (screen) =>
              footer(screen, FIXTURE_CHILD_MODEL, "low"),
            );
            await type(terminal, "keep working");
            await press(terminal, "chat.submit", (screen) => !composer(screen, "keep working"));
            await work.alive();

            const first = await provider.waitForRequest(
              (item) => item.script === "bash" && item.prompt === "keep working",
            );

            assert.equal(first.payload.reasoning_effort, "low", "The run starts at /effort low");
            await press(terminal, "chat.thinking.cycle", (screen) =>
              footer(screen, FIXTURE_CHILD_MODEL, "medium"),
            );
            await type(terminal, "queued follow-up");
            await press(
              terminal,
              "chat.queue.submit",
              (screen) =>
                !composer(screen, "queued follow-up") &&
                screen.lines.some((line) => line.includes("↓ queued follow-up")),
            );
            await work.release();

            const continuation = await provider.waitForRequest(
              (item) => item.script === "continuation",
            );

            await provider.waitForStage(continuation.id, "held");
            assert.equal(
              continuation.payload.reasoning_effort,
              "low",
              "The tool continuation keeps the level its run started with",
            );
            assert.ok(
              !provider.requests.some((item) => item.script === "queued follow-up"),
              "The follow-up waits while the run is still streaming",
            );
            provider.release(continuation.id, " and finishes.");
            await terminal.waitForScreen(
              (screen) => screen.text.includes("The queued follow-up arrived.") && idle(screen),
              deadline(),
            );

            const followUp = await provider.waitForRequest(
              (item) => item.script === "queued follow-up",
            );

            assert.equal(followUp.payload.reasoning_effort, "medium");
            await work.stopped(false);
          },
        );

        await context.beat(
          "a question waits for a picked answer, which reaches the model as the tool result",
          async () => {
            provider.enqueue(
              {
                name: "question",
                model: FIXTURE_CHILD_MODEL,
                prompt: "ask me something",
                action: {
                  kind: "tool",
                  name: "question",
                  arguments: {
                    question: "Choose a QA answer",
                    options: [{ label: "First" }, { label: "Second" }],
                  },
                },
              },
              {
                name: "answered",
                model: FIXTURE_CHILD_MODEL,
                prompt: "ask me something",
                action: { kind: "reply", text: "You picked an answer." },
              },
            );
            await type(terminal, "ask me something");
            await press(terminal, "chat.submit", (screen) =>
              /type your own answer/iu.test(screen.text),
            );
            await press(terminal, "picker.next", (screen) =>
              screen.lines.some((line) => /❯.*Second/u.test(line)),
            );
            await press(
              terminal,
              "picker.accept",
              (screen) => screen.text.includes("You picked an answer.") && idle(screen),
            );

            const asked = await provider.waitForRequest((item) => item.script === "question");
            const answered = await provider.waitForRequest((item) => item.script === "answered");

            const users = (request: typeof asked) =>
              request.payload.messages.filter((message) => message.role === "user").length;

            assert.equal(users(answered), users(asked), "Answering adds no user message");
            assert.ok(
              answered.payload.messages.some(
                (message) =>
                  message.role === "tool" && JSON.stringify(message.content).includes("Second"),
              ),
              "The picked answer reaches the provider as the tool result",
            );
          },
        );

        await context.beat(
          "a ! command runs locally, Esc stops it, and kept output rides with the next message",
          async () => {
            const shell = await tool("shell-heartbeat");
            provider.enqueue({
              name: "shell context",
              model: FIXTURE_CHILD_MODEL,
              prompt: "with the shell output",
              action: { kind: "reply", text: "The shell output arrived." },
            });
            const requests = provider.requests.length;
            await type(terminal, `!${shell.command}`);
            assert.ok(terminal.screen().text.includes("enter run locally"));
            await press(
              terminal,
              "chat.submit",
              (screen) =>
                screen.lines.some(
                  (line) => line.includes("● !") && line.includes("cd shell-heartbeat &&"),
                ) && screen.text.includes("esc stop command"),
            );
            await shell.alive();
            await press(terminal, "chat.interrupt", (screen) =>
              screen.lines.some(
                (line) => line.includes("✗ !") && line.includes("cd shell-heartbeat &&"),
              ),
            );
            await shell.stopped(true);
            assert.equal(provider.requests.length, requests, "Local commands contact no model");
            await type(terminal, "!echo kept");
            await press(
              terminal,
              "chat.submit",
              (screen) =>
                screen.lines.some((line) => line.includes("✓ ! echo kept")) &&
                composer(screen, "[Shell echo kept] "),
            );
            await type(terminal, "with the shell output", { prefix: "[Shell echo kept] " });
            await press(
              terminal,
              "chat.submit",
              (screen) => screen.text.includes("The shell output arrived.") && idle(screen),
            );

            const kept = await provider.waitForRequest((item) => item.script === "shell context");

            assert.ok(
              kept.prompt.includes('<shell command="echo kept" exit="0">\nkept\n</shell>'),
              kept.prompt,
            );
            assert.equal(kept.prompt.match(/<shell /gu)?.length, 1, kept.prompt);
            assert.ok(kept.prompt.endsWith("with the shell output"), kept.prompt);
          },
        );

        await context.beat("settings shows the thinking level; Esc closes it", async () => {
          await command(
            terminal,
            "settings",
            (screen) =>
              screen.text.includes("Settings") &&
              screen.lines.some((line) => /thinking level/iu.test(line)),
          );
          await press(
            terminal,
            "picker.close",
            (screen) => !screen.text.includes("Settings") && emptyComposer(screen),
          );
        });

        let sessionId = "";

        await context.beat(
          "/quit prints the resume command; --session reopens the transcript, model and level",
          async () => {
            sessionId = await quit(terminal);
            terminal = await open([`--session=${sessionId}`]);
            await terminal.waitForScreen(
              (screen) =>
                ready(screen) &&
                screen.text.includes("The shell output arrived.") &&
                footer(screen, FIXTURE_CHILD_MODEL, "medium"),
              deadline(),
            );
            assert.ok(!terminal.screen().text.includes(WORKSPACE_TRUST_TITLE), "Trust was saved");
            const before = chat().length;
            await type(terminal, "after the restart");
            await press(
              terminal,
              "chat.submit",
              (screen) => screen.text.includes("Still the child model.") && idle(screen),
            );

            const request = await provider.waitForRequest(
              (item) => item.script === "after restart",
            );

            assert.equal(request.model, FIXTURE_CHILD_MODEL);
            assert.equal(request.payload.reasoning_effort, "medium");
            assert.ok(JSON.stringify(request.payload.messages).includes("hi nyte"));
            assert.equal(chat().length, before + 1, "Resuming replays no earlier request");
          },
        );

        await context.beat("SIGTERM prints the same resume command and exits 143", async () => {
          terminal.signal("SIGTERM");
          assert.equal(await resumeSession(terminal, 143), sessionId);
        });

        // The old models.during-turn shape: /effort before a session's first message.
        await context.beat(
          "a new session's first message uses the /effort level chosen before it",
          async () => {
            provider.enqueue({
              name: "first message",
              model: FIXTURE_CHILD_MODEL,
              prompt: "first message of a new session",
              action: { kind: "reply", text: "A new session answered." },
            });
            terminal = await open();
            await terminal.waitForScreen(
              (screen) => ready(screen) && footer(screen, FIXTURE_CHILD_MODEL, "medium"),
              deadline(),
            );
            await command(terminal, "effort low", (screen) =>
              footer(screen, FIXTURE_CHILD_MODEL, "low"),
            );
            await type(terminal, "first message of a new session");
            await press(
              terminal,
              "chat.submit",
              (screen) => screen.text.includes("A new session answered.") && idle(screen),
            );

            const request = await provider.waitForRequest(
              (item) => item.script === "first message",
            );

            assert.equal(request.payload.reasoning_effort, "low");
            await press(terminal, "chat.quit", (screen) => screen.text.includes("To resume"));
            await terminal.waitForExit(deadline());
          },
        );
      },
    ),
};
