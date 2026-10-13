import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
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
import type { ProviderPayload } from "./provider.ts";
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

        await context.beat("the project plugin's command answers", async () => {
          await terminal.waitForScreen(
            (screen) => ready(screen) && footer(screen, FIXTURE_MODEL, "minimal"),
            deadline(),
          );
          await command(terminal, "qa-probe", (screen) =>
            screen.text.includes("QA plugin answered"),
          );
          assert.ok((await pluginSetups()) > 0, "The project plugin activated");
        });

        await context.beat(
          "Cmd+Backspace deletes to the line start; undo and other deletion keys still work",
          async () => {
            const preserved = "kept 前";
            const draft = `${preserved}\ndelete me tail`;
            const pasted = terminal.raw(`\x1b[200~${draft}\x1b[201~`, "paste.editing");
            await terminal.waitForScreen(
              (screen) => composer(screen, preserved) && screen.text.includes("delete me tail"),
              deadline(),
              pasted,
            );
            const end = terminal.screen().cursor;
            const moved = terminal.raw("\x1b[D".repeat(4), "cursor.left");
            await terminal.waitForScreen(
              (screen) => screen.cursor.y === end.y && screen.cursor.x === end.x - 4,
              deadline(),
              moved,
            );

            const deleted = (screen: Screen) =>
              composer(screen, preserved) &&
              screen.lines.some((line) => /^\s*│\s+tail\s+│\s*$/u.test(line)) &&
              !screen.text.includes("delete me");

            await press(terminal, "composer.delete.to.line.start", deleted);
            const undo = terminal.raw("\x1b[122;9u", "super+z");
            await terminal.waitForScreen(
              (screen) => screen.text.includes("delete me tail"),
              deadline(),
              undo,
            );
            const cleared = terminal.raw("\x15", "ctrl+u");
            await terminal.waitForScreen(deleted, deadline(), cleared);
            await press(terminal, "chat.quit", emptyComposer);
            await type(terminal, "word remove");
            const word = terminal.raw("\x1b\x7f", "option+backspace");

            const shortened = await terminal.waitForScreen(
              (screen) => composer(screen, "word ") && !screen.text.includes("remove"),
              deadline(),
              word,
            );

            const character = terminal.raw("\x7f", "backspace");
            await terminal.waitForScreen(
              (screen) => composer(screen, "word") && screen.cursor.x === shortened.cursor.x - 1,
              deadline(),
              character,
            );
            await press(terminal, "chat.quit", emptyComposer);
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
                screen.text.includes(`${FIXTURE_PROVIDER}/${FIXTURE_MODEL} · Minimal`),
            );
            await press(terminal, "model.next", (screen) =>
              screen.text.includes(`${FIXTURE_PROVIDER}/${FIXTURE_CHILD_MODEL} · Minimal`),
            );
            await press(
              terminal,
              "picker.accept",
              (screen) =>
                !screen.text.includes("Type to search") &&
                footer(screen, FIXTURE_CHILD_MODEL, "minimal"),
            );
            await press(terminal, "chat.thinking.cycle", (screen) =>
              footer(screen, FIXTURE_CHILD_MODEL, "low"),
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
            assert.equal(request.payload.reasoning_effort, "low");
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
            await command(terminal, "effort minimal", (screen) =>
              footer(screen, FIXTURE_CHILD_MODEL, "minimal"),
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
          "answered questions close: a second question shows, the composer sends again, and a stop clears an open one",
          async () => {
            provider.enqueue(
              {
                name: "question",
                model: FIXTURE_CHILD_MODEL,
                prompt: "ask me something",
                action: {
                  kind: "tool",
                  name: "question",
                  arguments: { prompt: "Choose a QA answer", options: ["First", "Second"] },
                },
              },
              {
                name: "second question",
                model: FIXTURE_CHILD_MODEL,
                prompt: "ask me something",
                action: {
                  kind: "tool",
                  name: "question",
                  arguments: { prompt: "Name a QA colour", options: ["Red", "Blue"] },
                },
              },
              {
                name: "answered",
                model: FIXTURE_CHILD_MODEL,
                prompt: "ask me something",
                action: { kind: "reply", text: "You answered both." },
              },
              {
                name: "after questions",
                model: FIXTURE_CHILD_MODEL,
                prompt: "plain after questions",
                action: { kind: "reply", text: "The plain message arrived." },
              },
              {
                name: "question to stop",
                model: FIXTURE_CHILD_MODEL,
                prompt: "ask then stop",
                action: {
                  kind: "tool",
                  name: "question",
                  arguments: { prompt: "Stop me before I answer", options: ["Keep", "Drop"] },
                },
              },
              {
                name: "after stop",
                model: FIXTURE_CHILD_MODEL,
                prompt: "message after the stop",
                action: { kind: "reply", text: "Sent after the stop." },
              },
            );

            const toolResult = (request: { readonly payload: ProviderPayload }, text: string) =>
              request.payload.messages.some(
                (message) => message.role === "tool" && JSON.stringify(message.content).includes(text),
              );

            const users = (request: { readonly payload: ProviderPayload }) =>
              request.payload.messages.filter((message) => message.role === "user").length;

            await type(terminal, "ask me something");
            await press(
              terminal,
              "chat.submit",
              (screen) =>
                screen.text.includes("Choose a QA answer") && screen.text.includes("Type an answer"),
            );
            await press(terminal, "picker.next", (screen) =>
              screen.lines.some((line) => /❯.*Second/u.test(line)),
            );
            await press(
              terminal,
              "picker.accept",
              (screen) => screen.text.includes("Name a QA colour") && screen.text.includes("esc later"),
            );
            await press(
              terminal,
              "picker.close",
              (screen) =>
                !screen.lines.some((line) => /❯.*Red/u.test(line)) &&
                screen.text.includes("Type an answer, or press"),
            );
            await type(terminal, "Green");
            await press(
              terminal,
              "chat.submit",
              (screen) => screen.text.includes("You answered both.") && idle(screen),
            );

            const asked = await provider.waitForRequest((item) => item.script === "question");
            const second = await provider.waitForRequest((item) => item.script === "second question");
            const answered = await provider.waitForRequest((item) => item.script === "answered");

            assert.ok(toolResult(second, "Second"), "The picked answer reaches the model");
            assert.ok(toolResult(answered, "Green"), "An answer in the user's words reaches the model");
            assert.equal(users(answered), users(asked), "Answering adds no user message");

            await type(terminal, "plain after questions");
            await press(
              terminal,
              "chat.submit",
              (screen) => screen.text.includes("The plain message arrived.") && idle(screen),
            );
            assert.equal(
              users(await provider.waitForRequest((item) => item.script === "after questions")),
              users(answered) + 1,
              "After the questions, a message sends as the user's own",
            );

            await type(terminal, "ask then stop");
            await press(
              terminal,
              "chat.submit",
              (screen) =>
                screen.text.includes("Stop me before I answer") && screen.text.includes("esc later"),
            );
            await press(terminal, "picker.close", (screen) =>
              screen.text.includes("Type an answer, or press"),
            );
            await press(
              terminal,
              "chat.interrupt",
              (screen) =>
                screen.lines.some(
                  (line) => line.includes("✗") && line.includes("Stop me before I answer"),
                ) &&
                emptyComposer(screen) &&
                idle(screen),
            );
            await type(terminal, "message after the stop");
            await press(
              terminal,
              "chat.submit",
              (screen) => screen.text.includes("Sent after the stop.") && idle(screen),
            );
          },
        );

        await context.beat(
          "a background subagent's report wakes the finished parent and shows as a report, not the user's message",
          async () => {
            const createdChild = (payload: ProviderPayload): string => {
              const text = payload.messages
                .map((message) =>
                  Array.isArray(message.content)
                    ? message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
                    : (message.content ?? ""),
                )
                .join("\n");

              const id = /Created subagent ([0-9a-f-]{36})\./u.exec(text)?.[1];
              assert.ok(id !== undefined, "The create call's result names the subagent");

              return id;
            };

            provider.enqueue(
              {
                name: "create helper",
                prompt: "start a background helper",
                action: { kind: "tool", name: "create", arguments: { title: "QA helper" } },
              },
              {
                name: "send helper",
                prompt: "start a background helper",
                action: {
                  kind: "tool",
                  name: "send",
                  arguments: (payload) => ({
                    session: createdChild(payload),
                    prompt: "do the qa child task",
                  }),
                },
              },
              {
                name: "helper started",
                prompt: "start a background helper",
                action: { kind: "reply", text: "Helper started in the background." },
              },
              {
                name: "child task",
                prompt: "do the qa child task",
                action: { kind: "hold", text: "Child finished the QA task." },
              },
              {
                name: "parent woken",
                prompt: "Child finished the QA task",
                action: { kind: "reply", text: "The helper reported back." },
              },
            );
            await type(terminal, "start a background helper");
            await press(
              terminal,
              "chat.submit",
              (screen) => screen.text.includes("Helper started in the background.") && idle(screen),
            );

            const child = await provider.waitForRequest((item) => item.script === "child task");
            await provider.waitForStage(child.id, "held");
            provider.release(child.id);

            await terminal.waitForScreen(
              (screen) =>
                screen.text.includes("The helper reported back.") &&
                screen.lines.some((line) => /↳ subagent .*completed/u.test(line)) &&
                !/Child [0-9a-f-]{36} completed:/u.test(screen.text) &&
                idle(screen),
              deadline(),
            );

            const woken = await provider.waitForRequest((item) => item.script === "parent woken");

            assert.ok(
              woken.payload.messages.some(
                (message) =>
                  message.role === "user" &&
                  JSON.stringify(message.content).includes("Child finished the QA task."),
              ),
              "The report reaches the woken parent",
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
