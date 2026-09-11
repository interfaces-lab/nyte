import assert from "node:assert/strict";
import { cases } from "./cases.ts";
import { modelSelection } from "./model-selection.ts";
import {
  beat,
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
import {
  bashRequest,
  editRequest,
  questionRequest,
  subagentRequest,
  thinkingReply,
} from "./provider.ts";
import { FIXTURE_CHILD_MODEL, FIXTURE_MODEL, FIXTURE_PROVIDER } from "./workspace.ts";
import type { Scenario, Screen, Terminal } from "./types.ts";

const idle = (screen: Screen) => screen.text.includes("enter send");
const emptyComposer = (screen: Screen) => composer(screen, "Plan, search, build anything");
const earlierLines = /… \d+ earlier lines · ctrl\+o expand/u;
const heartbeatRows = (screen: Screen) =>
  screen.lines.filter((line) => line.includes("QA tool heartbeat")).length;
const labelRows = (screen: Screen) => screen.lines.filter((line) => earlierLines.test(line)).length;
const backgrounded = (screen: Screen) =>
  screen.lines.filter((line) => line.includes("Running in background.")).length;
const picker = (screen: Screen, model: string, level: string) =>
  screen.text.includes("Type to search") &&
  screen.text.includes(`${FIXTURE_PROVIDER}/${model} · ${level}`);

/** Rows repaint on their own (elapsed time, truncation), so the cursor's row index is what proves a key moved it. */
function cursorRow(screen: Screen): number {
  return screen.lines.findIndex(
    (line) => line.trimStart().startsWith("❯") && !line.includes("│ ❯"),
  );
}

/** Moves the Tasks cursor until its row shows the task's command, then requests cancellation. */
async function stopTask(terminal: Terminal, rowText: string): Promise<void> {
  const onRow = (screen: Screen) => screen.lines[cursorRow(screen)]?.includes(rowText) ?? false;
  for (let presses = 0; !onRow(terminal.screen()); presses++) {
    assert.ok(presses < 20, `${rowText} is reachable in Tasks`);
    const before = cursorRow(terminal.screen());
    await press(terminal, "picker.next", (screen) => cursorRow(screen) !== before);
  }
  await press(terminal, "chat.task.stop", (screen) =>
    screen.text.includes("Cancellation requested."),
  );
}

/** Pages the transcript until `visible` shows and `hidden` has left, bounded by a fixed number of presses. */
async function scrollUntil(
  terminal: Terminal,
  action: "chat.scroll.page.up" | "chat.scroll.page.down",
  visible: readonly string[],
  hidden: string,
): Promise<void> {
  const shows = (text: string) => visible.every((expected) => text.includes(expected));
  for (let presses = 0; !shows(terminal.screen().text); presses++) {
    assert.ok(presses < 40, `${visible.join(", ")} appear within 40 ${action} presses`);
    const before = terminal.screen().text;
    await press(terminal, action, (screen) => screen.text !== before);
  }
  // A press is observed at its first changed row; the rest of the frame follows.
  await terminal.waitForScreen(
    (screen) => shows(screen.text) && !screen.text.includes(hidden),
    deadline(),
  );
}

const short: Scenario = {
  name: "journey.short",
  covers: [
    "Workspace trust: untouched default declines before provider work",
    "Workspace trust: acceptance persists across restart",
    "Messages and delivery lanes",
    "Enter to transcript",
    "latency.submit",
    "Streaming transcript and tools",
    "latency.streaming",
    "latency.cancel",
    "cancel",
    "stop with queued steer continues the run",
    "draft retention",
    "Ctrl+C clear",
    "stop with empty queue hands the message back",
    "Terminal lifecycle and integrations",
    "copyable resume",
    "slash",
    "control-c",
  ],
  run: (context) =>
    session(
      context,
      {
        trusted: false,
        steps: [
          {
            name: "quick answer",
            prompt: "what is nyte",
            action: { kind: "reply", text: "Nyte is a terminal coding agent." },
          },
          {
            name: "stream",
            prompt: "tell me more",
            action: { kind: "hold", text: "More detail is streaming" },
          },
          { name: "steered", prompt: "steer now", action: { kind: "hold", text: "Steer landed" } },
          // Held before any answer text: only an unanswered stop hands the message back.
          { name: "handback", prompt: "one last thing", action: { kind: "hold", text: "" } },
        ],
      },
      async ({ terminal: first, provider, reopen }) => {
        let terminal = first;
        await beat("untrusted launch shows the trust prompt with Quit selected", async () => {
          await terminal.waitForScreen(
            (screen) =>
              screen.text.includes("Workspace Trust Required") &&
              screen.text.includes("▸ [q] Quit"),
            deadline(),
          );
        });
        await beat("Enter on the default declines and exits without provider work", async () => {
          await press(
            terminal,
            "workspace.accept",
            (screen) => !screen.text.includes("Workspace Trust Required"),
          );
          assert.equal(await terminal.waitForExit(deadline()), 0);
          await terminal.close();
          assert.equal(provider.requests.length, 0);
        });
        await beat("reopening asks for trust again; accepting reaches the composer", async () => {
          terminal = await reopen();
          await terminal.waitForScreen(
            (screen) => screen.text.includes("Workspace Trust Required"),
            deadline(),
          );
          await press(terminal, "workspace.toggle", (screen) =>
            screen.text.includes("▸ [a] Trust this workspace"),
          );
          await press(terminal, "workspace.accept", ready);
        });
        await beat("a short question moves to the transcript and gets its reply", async () => {
          await type(terminal, "what is nyte");
          await press(
            terminal,
            "chat.submit",
            (screen) => screen.text.includes("what is nyte") && !composer(screen, "what is nyte"),
          );
          await terminal.waitForScreen(
            (screen) => screen.text.includes("Nyte is a terminal coding agent."),
            deadline(),
          );
          const request = await provider.waitForRequest((item) => item.script === "quick answer");
          assert.equal(request.prompt, "what is nyte");
          assert.equal(request.model, FIXTURE_MODEL);
        });
        await beat(
          "a steer queued during streaming survives the stop and continues the run",
          async () => {
            await type(terminal, "tell me more");
            await press(terminal, "chat.submit", (screen) =>
              screen.text.includes("More detail is streaming"),
            );
            const stream = await provider.waitForRequest((item) => item.script === "stream");
            await provider.waitForStage(stream.id, "held");
            await type(terminal, "steer now");
            await press(
              terminal,
              "chat.submit",
              (screen) => screen.text.includes("steer now") && !composer(screen, "steer now"),
            );
            terminal.key("chat.interrupt");
            await provider.waitForStage(stream.id, "aborted");
            const steered = await provider.waitForRequest((item) => item.script === "steered");
            await provider.waitForStage(steered.id, "held");
            const users = steered.payload.messages.filter((message) => message.role === "user");
            assert.equal(users.length, 3, "The steer joins the conversation already in progress");
            assert.ok(JSON.stringify(users.at(-2)?.content).includes("tell me more"));
            assert.equal(steered.prompt, "steer now");
            await terminal.waitForScreen(
              (screen) => screen.text.includes("Steer landed"),
              deadline(),
            );
            assert.ok(
              !terminal.screen().text.includes("back in the composer"),
              "A continued run hands nothing back",
            );
          },
        );
        await beat("stopping over a typed draft keeps the draft; Ctrl+C clears it", async () => {
          const steered = await provider.waitForRequest((item) => item.script === "steered");
          await type(terminal, "keep this draft");
          // The earlier stop's label is still on screen; the run's idle hints and the
          // provider's aborted stream are what prove this stop landed.
          await press(
            terminal,
            "chat.interrupt",
            (screen) => screen.text.includes("enter send") && composer(screen, "keep this draft"),
          );
          await provider.waitForStage(steered.id, "aborted");
          await press(terminal, "chat.quit", (screen) => !screen.text.includes("keep this draft"));
          assert.ok(composer(terminal.screen(), ""));
        });
        await beat(
          "stopping an unanswered run with nothing queued hands the message back",
          async () => {
            await type(terminal, "one last thing");
            await press(terminal, "chat.submit", (screen) => !composer(screen, "one last thing"));
            const held = await provider.waitForRequest((item) => item.script === "handback");
            await provider.waitForStage(held.id, "held");
            await press(terminal, "chat.interrupt", (screen) =>
              screen.text.includes("Message is back in the composer"),
            );
            await provider.waitForStage(held.id, "aborted");
            assert.ok(composer(terminal.screen(), "one last thing"));
            assert.equal(provider.requests.filter((item) => item.script === "handback").length, 1);
          },
        );
        let sessionId = "";
        await beat("/quit prints the two-line resume command", async () => {
          await press(terminal, "chat.quit", (screen) => !screen.text.includes("one last thing"));
          sessionId = await quit(terminal);
        });
        await beat("--session reopens the same transcript without a trust prompt", async () => {
          terminal = await reopen([`--session=${sessionId}`]);
          await terminal.waitForScreen(
            (screen) =>
              ready(screen) &&
              screen.text.includes("Nyte is a terminal coding agent.") &&
              screen.text.includes("Steer landed"),
            deadline(),
          );
          assert.ok(!terminal.screen().text.includes("Workspace Trust Required"));
          assert.equal(
            provider.requests.filter((item) => item.script !== "automatic conversation title")
              .length,
            4,
            "Resume replays nothing",
          );
        });
        await beat("Ctrl+C on an empty composer exits with the resume command", async () => {
          terminal.key("chat.quit");
          assert.equal(await resumeSession(terminal, 0), sessionId);
        });
      },
    ),
};

const long: Scenario = {
  name: "journey.long",
  localInputs: ["text.idle"],
  covers: [
    "Composer editing",
    "latency.idle",
    "Unicode",
    "Unicode input",
    "provider payload fidelity",
    "Local shell: first-character prefix, one foreground command, Esc and quit terminate processes",
    "User shell: !! excludes context; ! enters the next prompt once",
    "Local shell: submitted output resumes as chat context; private executions stay local",
    "Backgrounding foreground bash does not cancel it",
    "Tasks: cancel selected bash terminates process",
    "Parent stop cancels its background bash",
    "Tasks and child inspection",
    "parent cancels foreground subagent",
    "parent cancels background subagent",
    "Parent stop cancels subagents",
    "Cancelled child-owned bash terminates",
    "Background child and child-owned background bash are cancelled",
    "Questions: answer owns input, no extra user message",
    "Questions: dismiss and answer later",
    "Questions: typed answer is the reply",
    "Queue: cancel edit restores draft",
    "Queue: save restores draft",
    "Queue: edited content reaches provider once",
    "Queue: removal prevents delivery",
    "Model and effort selection",
    "latency.picker",
    "no network prerequisite",
    "Model: confirmed selection controls provider request",
    "Model: selection survives binary restart",
    "Effort: each Shift+Tab paints cached selection within 50 ms",
    "Effort: HTTP receives selected level",
    "Effort: uninterrupted Shift+Tab burst and submission retain last intent",
    "Effort: Right/Left draft locally, cancel discards, confirm survives restart",
    "Usage and reports",
    "latency.panel",
    "Tasks: cancel selected child",
    "Selected child-owned bash terminates",
    "Parent and sibling survive selected cancellation",
  ],
  run: (context) =>
    session(
      context,
      { question: true, reasoning: true, height: 40 },
      async ({ terminal: first, provider, reopen, tool }) => {
        let terminal = first;
        const independent = await tool("independent");
        const owned = await tool("owned");
        const child = await tool("child");
        const background = await tool("background");
        const selected = await tool("selected");
        const sibling = await tool("sibling");
        const tail = await tool("tail");
        const shellEscape = await tool("shell-escape");
        const shell = await tool("shell");
        const unicode = "cafe\u0301 👩‍💻";
        const thinking = Array.from({ length: 18 }, (_, i) => `QA thought line ${String(i + 1)}`);
        // One ordered script; prompts pin each step to the message a person sent.
        // The parent switches to the child model midway, so later parent steps name it.
        provider.enqueue(
          {
            name: "greeting",
            prompt: "hi nyte",
            action: { kind: "reply", text: "Hello! Ready when you are." },
          },
          { ...bashRequest(independent.command), prompt: "run the heartbeat" },
          {
            name: "after backgrounding",
            prompt: "run the heartbeat",
            action: { kind: "hold", text: "Parent continues after backgrounding" },
          },
          {
            name: "bash cancellation notification",
            prompt: "Background command",
            action: { kind: "reply", text: "Independent bash cancellation received" },
          },
          { ...bashRequest(owned.command), prompt: "run the heartbeat again" },
          {
            name: "after backgrounding again",
            prompt: "run the heartbeat again",
            action: { kind: "hold", text: "Parent continues after backgrounding again" },
          },
          {
            ...subagentRequest({ background: false, prompt: "child heartbeat work" }),
            prompt: "delegate child work",
          },
          {
            ...bashRequest(child.command),
            model: FIXTURE_CHILD_MODEL,
            prompt: "child heartbeat work",
          },
          {
            ...subagentRequest({ background: true, prompt: "background child work" }),
            prompt: "delegate background work",
          },
          {
            ...bashRequest(background.command, true),
            model: FIXTURE_CHILD_MODEL,
            prompt: "background child work",
          },
          {
            name: "child waiting",
            model: FIXTURE_CHILD_MODEL,
            prompt: "background child work",
            action: { kind: "hold", text: "Child waiting with bash alive" },
          },
          {
            name: "parent waiting",
            prompt: "delegate background work",
            action: { kind: "hold", text: "Parent waiting for cancellation" },
          },
          { ...questionRequest("Choose a QA answer"), prompt: "ask the QA question" },
          {
            name: "answer continuation",
            prompt: "ask the QA question",
            action: { kind: "reply", text: "QA answer received" },
          },
          { ...questionRequest("Type a QA answer"), prompt: "ask the QA question again" },
          {
            name: "typed answer continuation",
            prompt: "ask the QA question again",
            action: { kind: "reply", text: "Typed answer received" },
          },
          {
            name: "queue blocker",
            prompt: "hold while I manage the queue",
            action: { kind: "hold", text: "Queue blocker running" },
          },
          {
            name: "edited delivery",
            prompt: "queued original revised",
            action: { kind: "reply", text: "Edited queue delivered" },
          },
          {
            name: "chosen model",
            model: FIXTURE_CHILD_MODEL,
            prompt: "probe the chosen model",
            action: { kind: "reply", text: "Chosen model answered" },
          },
          {
            name: "cycle probe",
            model: FIXTURE_CHILD_MODEL,
            prompt: "cycle probe",
            action: { kind: "reply", text: "Cycle probe answered" },
          },
          {
            name: "cancel probe",
            model: FIXTURE_CHILD_MODEL,
            prompt: "cancel probe",
            action: { kind: "reply", text: "Cancel probe answered" },
          },
          {
            name: "confirm probe",
            model: FIXTURE_CHILD_MODEL,
            prompt: "confirm probe",
            action: { kind: "reply", text: "Confirm probe answered" },
          },
          {
            name: "unicode",
            model: FIXTURE_CHILD_MODEL,
            prompt: unicode,
            action: { kind: "reply", text: "Received Unicode" },
          },
          {
            ...subagentRequest({ background: true, prompt: "sibling heartbeat child" }),
            model: FIXTURE_CHILD_MODEL,
            prompt: "start two heartbeat children",
          },
          {
            ...bashRequest(sibling.command),
            model: FIXTURE_CHILD_MODEL,
            prompt: "sibling heartbeat child",
          },
          {
            ...subagentRequest({ background: true, prompt: "selected heartbeat child" }),
            model: FIXTURE_CHILD_MODEL,
            prompt: "start two heartbeat children",
          },
          {
            ...bashRequest(selected.command),
            model: FIXTURE_CHILD_MODEL,
            prompt: "selected heartbeat child",
          },
          {
            name: "parent remains",
            model: FIXTURE_CHILD_MODEL,
            prompt: "start two heartbeat children",
            action: { kind: "hold", text: "Parent remains active" },
          },
          {
            name: "sibling done",
            model: FIXTURE_CHILD_MODEL,
            prompt: "sibling heartbeat child",
            action: { kind: "reply", text: "Sibling completed naturally" },
          },
          {
            name: "sibling notification",
            model: FIXTURE_CHILD_MODEL,
            prompt: "Background subagent",
            action: { kind: "reply", text: "Parent received sibling completion" },
          },
          {
            name: "restart probe",
            model: FIXTURE_CHILD_MODEL,
            prompt: "restart probe",
            action: { kind: "reply", text: "Resumed model answered" },
            promptTokens: 100_000,
          },
          {
            ...bashRequest(tail.command),
            model: FIXTURE_CHILD_MODEL,
            prompt: "tail the heartbeat",
          },
          {
            name: "after tail",
            model: FIXTURE_CHILD_MODEL,
            prompt: "tail the heartbeat",
            action: { kind: "reply", text: "Tail heartbeat finished" },
          },
          { ...bashRequest("seq 1 10"), model: FIXTURE_CHILD_MODEL, prompt: "count to ten" },
          {
            name: "after counting",
            model: FIXTURE_CHILD_MODEL,
            prompt: "count to ten",
            action: { kind: "reply", text: "Counted to ten" },
          },
          {
            ...editRequest("total.ts", "price * qty;", "price * quantity;"),
            model: FIXTURE_CHILD_MODEL,
            prompt: "fix the total",
          },
          {
            name: "after edit",
            model: FIXTURE_CHILD_MODEL,
            prompt: "fix the total",
            action: { kind: "reply", text: "Renamed the total" },
          },
          {
            name: "parallel shell",
            model: FIXTURE_CHILD_MODEL,
            prompt: "continue while I check files",
            action: { kind: "hold", text: "Model still working" },
          },
          {
            name: "literal bang",
            model: FIXTURE_CHILD_MODEL,
            prompt: "!echo chat text",
            action: { kind: "reply", text: "That was a message, not a command" },
          },
          {
            name: "quiet shell",
            model: FIXTURE_CHILD_MODEL,
            prompt: "quiet shell",
            action: { kind: "reply", text: "Quiet shell answered" },
          },
          {
            name: "kept shell",
            model: FIXTURE_CHILD_MODEL,
            prompt: "kept shell",
            action: { kind: "reply", text: "Kept shell answered" },
          },
          {
            ...thinkingReply(thinking.join("\n"), "Thought it through"),
            model: FIXTURE_CHILD_MODEL,
            prompt: "think hard",
          },
        );

        const held = async (name: string) => {
          const request = await provider.waitForRequest((item) => item.script === name);
          await provider.waitForStage(request.id, "held");
          return request;
        };
        const count = (name: string) =>
          provider.requests.filter((item) => item.script === name).length;

        await beat("trusted launch lands on an idle composer with thinking off", async () => {
          await terminal.waitForScreen(
            (screen) => ready(screen) && footer(screen, FIXTURE_MODEL, "off"),
            deadline(),
          );
          assert.ok(!terminal.screen().text.includes("Workspace Trust Required"));
        });
        await beat("an idle greeting echoes every keystroke and gets a reply", async () => {
          await type(terminal, "hi nyte", { label: "text.idle" });
          await press(
            terminal,
            "chat.submit",
            (screen) => screen.text.includes("hi nyte") && !composer(screen, "hi nyte"),
          );
          await terminal.waitForScreen(
            (screen) => screen.text.includes("Hello! Ready when you are."),
            deadline(),
          );
          assert.equal(
            (await provider.waitForRequest((item) => item.script === "greeting")).prompt,
            "hi nyte",
          );
        });
        await beat("the footer reads the measured tokens against the context window", async () => {
          await terminal.waitForScreen(
            (screen) =>
              screen.lines.some(
                (line) => line.includes("╰") && line.includes("28/128.0k · 0% context"),
              ),
            deadline(),
          );
        });
        await beat("a long-running tool streams output, then Ctrl+Z backgrounds it", async () => {
          await type(terminal, "run the heartbeat");
          await press(terminal, "chat.submit", (screen) =>
            screen.text.includes("QA tool heartbeat"),
          );
          await independent.alive();
          await press(terminal, "chat.job.background", (screen) =>
            screen.text.includes("Running in background."),
          );
          await held("after backgrounding");
          await independent.alive();
        });
        await beat(
          "/tasks lists the tool; stopping it there terminates the process while the parent keeps running",
          async () => {
            const parent = await held("after backgrounding");
            await command(
              terminal,
              "tasks",
              (screen) =>
                screen.text.includes("Finished ·") &&
                screen.lines.some((line) => line.includes("❯") && line.includes("independent")),
            );
            await stopTask(terminal, "independent");
            await independent.stopped(true);
            assert.ok(
              !provider.events.some(
                (event) => event.requestId === parent.id && event.stage === "aborted",
              ),
              "Cancelling one job did not abort the parent",
            );
            provider.release(parent.id, " Parent survived the cancellation");
            await terminal.waitForScreen(
              (screen) =>
                screen.text.includes("Parent survived the cancellation") &&
                screen.text.includes("Independent bash cancellation received"),
              deadline(),
            );
          },
        );
        await beat("stopping the parent kills the tool it backgrounded", async () => {
          await type(terminal, "run the heartbeat again");
          await press(
            terminal,
            "chat.submit",
            (screen) => !composer(screen, "run the heartbeat again"),
          );
          await owned.alive();
          // The first backgrounding may still be on screen; only a new line proves this one.
          const before = backgrounded(terminal.screen());
          await press(terminal, "chat.job.background", (screen) => backgrounded(screen) > before);
          const parent = await held("after backgrounding again");
          await owned.alive();
          await press(terminal, "chat.interrupt", (screen) => screen.text.includes("Stopped"));
          await provider.waitForStage(parent.id, "aborted");
          await owned.stopped(true);
        });
        await beat("stopping the parent cancels a foreground child and its bash", async () => {
          await type(terminal, "delegate child work");
          await press(
            terminal,
            "chat.submit",
            (screen) => !composer(screen, "delegate child work"),
          );
          await child.alive();
          await press(terminal, "chat.interrupt", idle);
          await child.stopped(true);
        });
        await beat("stopping the parent cancels a background child and its bash", async () => {
          await type(terminal, "delegate background work");
          await press(
            terminal,
            "chat.submit",
            (screen) => !composer(screen, "delegate background work"),
          );
          await background.alive();
          const waiting = await held("child waiting");
          const parent = await held("parent waiting");
          await press(terminal, "chat.interrupt", idle);
          await background.stopped(true);
          await provider.waitForStage(waiting.id, "aborted");
          await provider.waitForStage(parent.id, "aborted");
        });
        await beat(
          "a question can be dismissed, revisited and answered without a new user message",
          async () => {
            await type(terminal, "ask the QA question");
            await press(terminal, "chat.submit", (screen) =>
              /type your own answer/iu.test(screen.text),
            );
            await press(
              terminal,
              "picker.close",
              (screen) => !/type your own answer/iu.test(screen.text) && composer(screen, ""),
            );
            await type(terminal, "a note while the question waits");
            await press(
              terminal,
              "chat.quit",
              (screen) => !screen.text.includes("a note while the question waits"),
            );
            assert.equal(count("answer continuation"), 0, "Nothing continues until the answer");
            await press(terminal, "chat.submit", (screen) =>
              /type your own answer/iu.test(screen.text),
            );
            await press(terminal, "picker.next", (screen) =>
              screen.lines.some((line) => /❯.*Second/u.test(line)),
            );
            await press(terminal, "picker.accept", (screen) =>
              screen.text.includes("QA answer received"),
            );
            const continuation = await provider.waitForRequest(
              (item) => item.script === "answer continuation",
            );
            assert.equal(continuation.prompt, "ask the QA question");
            assert.ok(
              continuation.payload.messages.some(
                (message) =>
                  message.role === "tool" && JSON.stringify(message.content).includes("Second"),
              ),
              "The answer reaches the provider as a tool result",
            );
            await type(terminal, "ask the QA question again");
            await press(terminal, "chat.submit", (screen) =>
              /type your own answer/iu.test(screen.text),
            );
            let typed = "";
            for (const character of "!echo my answer") {
              typed += character;
              const input = terminal.text(character);
              // Rows are captured trimmed, so a trailing space shows only as cursor movement.
              await terminal.waitForScreen(
                (screen) =>
                  screen.text.includes(`│ ${typed.trimEnd()}`) &&
                  (screen.cursor.x !== input.before.cursor.x ||
                    screen.cursor.y !== input.before.cursor.y),
                deadline(),
                input,
              );
            }
            await press(terminal, "picker.accept", (screen) =>
              screen.text.includes("Typed answer received"),
            );
            const typedContinuation = await provider.waitForRequest(
              (item) => item.script === "typed answer continuation",
            );
            assert.equal(typedContinuation.prompt, "ask the QA question again");
            assert.ok(
              typedContinuation.payload.messages.some(
                (message) =>
                  message.role === "tool" &&
                  JSON.stringify(message.content).includes("!echo my answer"),
              ),
              "The typed answer reaches the provider as a tool result",
            );
          },
        );
        await beat("a queued follow-up can be edited, the edit cancelled, then saved", async () => {
          await type(terminal, "hold while I manage the queue");
          await press(terminal, "chat.submit", (screen) =>
            screen.text.includes("Queue blocker running"),
          );
          await held("queue blocker");
          await type(terminal, "queued original");
          await press(
            terminal,
            "chat.queue.submit",
            (screen) =>
              !composer(screen, "queued original") && screen.text.includes("queued original"),
          );
          await type(terminal, "saved composer draft");
          await press(terminal, "chat.queue.open", (screen) =>
            screen.text.includes("Queued messages"),
          );
          await press(
            terminal,
            "chat.queue.edit",
            (screen) =>
              composer(screen, "queued original") && !screen.text.includes("Queued messages"),
          );
          await type(terminal, " changed", { prefix: "queued original" });
          await press(terminal, "chat.interrupt", (screen) =>
            composer(screen, "saved composer draft"),
          );
          await press(terminal, "chat.queue.open", (screen) =>
            screen.text.includes("Queued messages"),
          );
          assert.ok(!terminal.screen().text.includes("queued original changed"));
          await press(
            terminal,
            "chat.queue.edit",
            (screen) =>
              composer(screen, "queued original") && !screen.text.includes("Queued messages"),
          );
          await type(terminal, " revised", { prefix: "queued original" });
          await press(
            terminal,
            "chat.submit",
            (screen) =>
              composer(screen, "saved composer draft") &&
              screen.text.includes("Queued message saved"),
          );
        });
        await beat(
          "a second queued message is removed; only the edited one is delivered",
          async () => {
            const blocker = await held("queue blocker");
            await press(
              terminal,
              "chat.queue.submit",
              // The durable queue glyph, not the sending one: the menu resets its
              // cursor when admission lands, so open it only once the row is settled.
              (screen) =>
                !composer(screen, "saved composer draft") &&
                screen.lines.some((line) => line.includes("↓ saved composer draft")),
            );
            await press(terminal, "chat.queue.open", (screen) =>
              screen.text.includes("Queued messages"),
            );
            // Move the edited message behind the draft, then reopen: the menu's
            // cursor starts on the first row, which is now the one to remove.
            await press(
              terminal,
              "chat.queue.down",
              (screen) =>
                screen.lines.some((line) => line.includes("saved composer draft")) &&
                screen.lines.findIndex((line) => line.includes("↓ saved composer draft")) <
                  screen.lines.findIndex((line) => line.includes("↓ queued original revised")),
            );
            await press(
              terminal,
              "picker.close",
              (screen) => !screen.text.includes("Queued messages"),
            );
            await press(
              terminal,
              "chat.queue.open",
              (screen) =>
                screen.text.includes("Queued messages") &&
                (screen.lines[cursorRow(screen)]?.includes("saved composer draft") ?? false),
            );
            await press(terminal, "chat.queue.delete", (screen) =>
              screen.text.includes("Removed from the queue"),
            );
            provider.release(blocker.id, " Queue blocker finished");
            await terminal.waitForScreen(
              (screen) => screen.text.includes("Edited queue delivered") && idle(screen),
              deadline(),
            );
            const delivered = await provider.waitForRequest(
              (item) => item.script === "edited delivery",
            );
            assert.equal(delivered.prompt, "queued original revised");
            assert.equal(count("edited delivery"), 1);
            assert.ok(
              !provider.requests.some((item) => item.prompt.includes("saved composer draft")),
              "A removed queue entry is never delivered",
            );
          },
        );
        await beat("paging and plugin reload preserve the transcript viewport", async () => {
          assert.ok(!terminal.screen().text.includes("hi nyte"), "The transcript has scrolled");
          await scrollUntil(
            terminal,
            "chat.scroll.page.up",
            ["hi nyte", "Hello! Ready when you are."],
            "Edited queue delivered",
          );
          await command(
            terminal,
            "reload",
            (screen) =>
              screen.text.includes("Reloaded") &&
              screen.text.includes("hi nyte") &&
              !screen.text.includes("Edited queue delivered"),
          );
          await scrollUntil(
            terminal,
            "chat.scroll.page.down",
            ["Edited queue delivered"],
            "hi nyte",
          );
        });
        await beat(
          "the cached model picker filters, moves and confirms the next request's model",
          async () => {
            const requests = provider.requests.length;
            await command(terminal, "model", (screen) => picker(screen, FIXTURE_MODEL, "Off"));
            let query = "";
            for (const character of "nyte qa") {
              query += character;
              const input = terminal.text(character);
              await terminal.waitForScreen(
                (screen) =>
                  screen.text.includes(`/ ${query}`) &&
                  (screen.cursor.x !== input.before.cursor.x ||
                    screen.cursor.y !== input.before.cursor.y),
                deadline(),
                input,
              );
            }
            await press(terminal, "model.next", (screen) =>
              screen.text.includes("opencode/nyte-qa-child ·"),
            );
            await press(terminal, "model.previous", (screen) =>
              screen.text.includes("opencode/nyte-qa ·"),
            );
            await press(terminal, "model.next", (screen) =>
              screen.text.includes("opencode/nyte-qa-child ·"),
            );
            await press(
              terminal,
              "picker.accept",
              (screen) =>
                !screen.text.includes("Type to search") &&
                footer(screen, FIXTURE_CHILD_MODEL, "off"),
            );
            assert.equal(provider.requests.length, requests, "The picker uses the local catalog");
            await type(terminal, "probe the chosen model");
            await press(
              terminal,
              "chat.submit",
              (screen) => screen.text.includes("Chosen model answered") && idle(screen),
            );
            const chosen = await provider.waitForRequest((item) => item.script === "chosen model");
            assert.equal(chosen.model, FIXTURE_CHILD_MODEL);
          },
        );
        await beat(
          "Shift+Tab cycles thinking locally; the level reaches the provider",
          async () => {
            const requests = provider.requests.length;
            for (const level of ["minimal", "low", "medium", "high", "off"]) {
              await press(terminal, "chat.thinking.cycle", (screen) =>
                footer(screen, FIXTURE_CHILD_MODEL, level),
              );
            }
            assert.equal(provider.requests.length, requests, "Cycling never touches the network");
            await type(terminal, "cycle probe");
            // A burst with no waits between presses, then an immediate send: the last intent wins.
            terminal.key("chat.thinking.cycle");
            terminal.key("chat.thinking.cycle");
            const last = terminal.key("chat.thinking.cycle");
            terminal.key("chat.submit");
            await terminal.waitForScreen(
              (screen) => footer(screen, FIXTURE_CHILD_MODEL, "medium"),
              deadline(),
              last,
            );
            await terminal.waitForScreen(
              (screen) => screen.text.includes("Cycle probe answered") && idle(screen),
              deadline(),
            );
            const probe = await provider.waitForRequest((item) => item.script === "cycle probe");
            assert.equal(probe.payload.reasoning_effort, "medium");
          },
        );
        await beat(
          "the picker drafts a thinking level; Esc discards it, Enter applies it",
          async () => {
            await command(terminal, "model", (screen) =>
              picker(screen, FIXTURE_CHILD_MODEL, "Medium"),
            );
            await press(terminal, "model.increase", (screen) =>
              picker(screen, FIXTURE_CHILD_MODEL, "High"),
            );
            await press(terminal, "model.decrease", (screen) =>
              picker(screen, FIXTURE_CHILD_MODEL, "Medium"),
            );
            await press(terminal, "model.decrease", (screen) =>
              picker(screen, FIXTURE_CHILD_MODEL, "Low"),
            );
            assert.ok(
              footer(terminal.screen(), FIXTURE_CHILD_MODEL, "medium"),
              "A draft leaves the footer alone",
            );
            await press(
              terminal,
              "picker.close",
              (screen) =>
                !screen.text.includes("Type to search") &&
                footer(screen, FIXTURE_CHILD_MODEL, "medium"),
            );
            await type(terminal, "cancel probe");
            await press(
              terminal,
              "chat.submit",
              (screen) => screen.text.includes("Cancel probe answered") && idle(screen),
            );
            assert.equal(
              (await provider.waitForRequest((item) => item.script === "cancel probe")).payload
                .reasoning_effort,
              "medium",
            );
            await command(terminal, "model", (screen) =>
              picker(screen, FIXTURE_CHILD_MODEL, "Medium"),
            );
            await press(terminal, "model.decrease", (screen) =>
              picker(screen, FIXTURE_CHILD_MODEL, "Low"),
            );
            await press(
              terminal,
              "picker.accept",
              (screen) =>
                !screen.text.includes("Type to search") &&
                footer(screen, FIXTURE_CHILD_MODEL, "low"),
            );
            await type(terminal, "confirm probe");
            await press(
              terminal,
              "chat.submit",
              (screen) => screen.text.includes("Confirm probe answered") && idle(screen),
            );
            assert.equal(
              (await provider.waitForRequest((item) => item.script === "confirm probe")).payload
                .reasoning_effort,
              "low",
            );
          },
        );
        await beat("settings offers ordinary model controls; usage opens and closes", async () => {
          // The picker title can paint a frame before its rows.
          const settings = await command(
            terminal,
            "settings",
            (screen) =>
              screen.text.includes("Settings") &&
              screen.lines.some((line) => /thinking level/iu.test(line)),
          );
          assert.ok(!settings.lines.some((line) => /subagent model/iu.test(line)));
          await press(
            terminal,
            "picker.close",
            (screen) => !screen.text.includes("Settings") && composer(screen, ""),
          );
          await command(terminal, "usage", (screen) => screen.text.includes("Usage"));
          await press(
            terminal,
            "picker.close",
            (screen) => !screen.text.includes("Usage") && composer(screen, ""),
          );
        });
        await beat(
          "decomposed and ZWJ Unicode render as typed and reach the provider intact",
          async () => {
            // e + U+0301 is one grapheme on screen and must stay two code points on the wire.
            await type(terminal, unicode);
            await press(
              terminal,
              "chat.submit",
              (screen) => screen.text.includes("Received Unicode") && idle(screen),
            );
            assert.equal(
              (await provider.waitForRequest((item) => item.script === "unicode")).prompt,
              unicode,
            );
          },
        );
        await beat(
          "cancelling one background child from Tasks leaves the parent and its sibling alive",
          async () => {
            await type(terminal, "start two heartbeat children");
            await press(
              terminal,
              "chat.submit",
              (screen) => !composer(screen, "start two heartbeat children"),
            );
            await Promise.all([selected.alive(), sibling.alive()]);
            const parent = await held("parent remains");
            await command(
              terminal,
              "tasks",
              (screen) =>
                screen.text.includes("Finished ·") &&
                screen.text.includes("selected heartbeat child"),
            );
            await stopTask(terminal, "cd selected");
            await selected.stopped(true);
            await sibling.alive();
            assert.ok(
              !provider.events.some(
                (event) => event.requestId === parent.id && event.stage === "aborted",
              ),
              "Selected cancellation did not abort the parent",
            );
            await sibling.release();
            await sibling.stopped(false);
            const completed = await provider.waitForRequest(
              (item) => item.script === "sibling done",
            );
            await provider.waitForStage(completed.id, "completed");
            assert.ok(
              completed.payload.messages.some(
                (message) =>
                  message.role === "tool" &&
                  JSON.stringify(message.content).includes("QA tool completed"),
              ),
              "Sibling tool result reaches its provider continuation",
            );
            provider.release(parent.id, " Parent survived selected cancellation");
            await terminal.waitForScreen(
              (screen) =>
                screen.text.includes("Parent survived selected cancellation") &&
                screen.text.includes("Parent received sibling completion"),
              deadline(),
            );
          },
        );
        let sessionId = "";
        await beat(
          "/quit and --session resume keep the transcript, model and thinking level",
          async () => {
            const before = provider.requests.length;
            sessionId = await quit(terminal);
            terminal = await reopen([`--session=${sessionId}`]);
            await terminal.waitForScreen(
              (screen) =>
                ready(screen) &&
                screen.text.includes("Parent received sibling completion") &&
                footer(screen, FIXTURE_CHILD_MODEL, "low"),
              deadline(),
            );
            await type(terminal, "restart probe");
            await press(
              terminal,
              "chat.submit",
              (screen) => screen.text.includes("Resumed model answered") && idle(screen),
            );
            const probe = await provider.waitForRequest((item) => item.script === "restart probe");
            assert.equal(probe.model, FIXTURE_CHILD_MODEL);
            assert.equal(probe.payload.reasoning_effort, "low");
            assert.equal(provider.requests.length, before + 1, "Resume replays nothing");
          },
        );
        await beat("a heavy reply moves the footer into the seventies", async () => {
          await terminal.waitForScreen(
            (screen) =>
              screen.lines.some(
                (line) => line.includes("╰") && /100\.0k\/128\.0k · 7\d% context/u.test(line),
              ),
            deadline(),
          );
        });
        await beat(
          "a running bash card keeps its newest rows under an earlier-lines label",
          async () => {
            await type(terminal, "tail the heartbeat");
            // Older cards may still show a label or heartbeat rows; only growth proves this one.
            const labelsBefore = labelRows(terminal.screen());
            const heartbeatsBefore = heartbeatRows(terminal.screen());
            await press(terminal, "chat.submit", (screen) => labelRows(screen) > labelsBefore);
            await tail.alive();
            const running = terminal.screen();
            const labelRow = running.lines.findLastIndex((line) => earlierLines.test(line));
            const lastHeartbeatRow = running.lines.findLastIndex((line) =>
              line.includes("QA tool heartbeat"),
            );
            assert.ok(labelRow < lastHeartbeatRow, "The label sits above the kept tail");
            assert.equal(heartbeatRows(running) - heartbeatsBefore, 6);
            await press(
              terminal,
              "chat.tools.toggle",
              (screen) =>
                screen.text.includes("Output expanded") &&
                labelRows(screen) === 0 &&
                heartbeatRows(screen) > heartbeatsBefore + 6,
            );
            await press(
              terminal,
              "chat.tools.toggle",
              (screen) =>
                screen.text.includes("Output collapsed") && labelRows(screen) > labelsBefore,
            );
            await tail.release();
            await terminal.waitForScreen(
              (screen) => screen.text.includes("Tail heartbeat finished") && idle(screen),
              deadline(),
            );
            await tail.stopped(false);
          },
        );
        await beat("a settled bash card shows its last six lines", async () => {
          await type(terminal, "count to ten");
          await press(
            terminal,
            "chat.submit",
            (screen) => screen.text.includes("Counted to ten") && idle(screen),
          );
          const rows = terminal.screen().lines.map((line) => line.trim());
          assert.ok(rows.some((row) => row.includes("… 4 earlier lines · ctrl+o expand")));
          for (const kept of ["5", "6", "7", "8", "9", "10"]) assert.ok(rows.includes(kept));
          assert.ok(!rows.includes("1"), "The head is cut");
        });
        await beat("a one-line edit renders both rows of its diff", async () => {
          await type(terminal, "fix the total");
          await press(
            terminal,
            "chat.submit",
            (screen) => screen.text.includes("Renamed the total") && idle(screen),
          );
          const rows = terminal.screen().lines;
          const removed = rows.findIndex((row) => /2\s+-\s+return price \* qty;/u.test(row));
          const added = rows.findIndex((row) => /2\s+\+\s+return price \* quantity;/u.test(row));
          assert.ok(removed >= 0, "The removed row shows");
          assert.equal(added, removed + 1, "The added row follows the removed row");
        });
        await beat(
          "a local shell card does not stop the model transcript from streaming",
          async () => {
            await type(terminal, "continue while I check files");
            await press(terminal, "chat.submit", (screen) =>
              screen.text.includes("Model still working"),
            );
            const running = await provider.waitForRequest(
              (request) => request.script === "parallel shell",
            );
            await provider.waitForStage(running.id, "held");
            const requests = provider.requests.length;
            await type(terminal, "!!echo local check");
            await press(
              terminal,
              "chat.submit",
              (screen) => screen.text.includes("✓ !! echo local check") && composer(screen, ""),
            );
            provider.release(running.id, " Model finished independently");
            await terminal.waitForScreen(
              (screen) =>
                screen.text.includes("Model finished independently") &&
                screen.text.includes("✓ !! echo local check") &&
                idle(screen),
              deadline(),
            );
            assert.equal(
              provider.requests.length,
              requests,
              "Local execution makes no model request",
            );
          },
        );
        await beat("a bang after leading whitespace is a message, not a command", async () => {
          await type(terminal, " !echo chat text");
          await press(
            terminal,
            "chat.submit",
            (screen) => screen.text.includes("That was a message, not a command") && idle(screen),
          );
          const request = await provider.waitForRequest((item) => item.script === "literal bang");
          assert.equal(request.prompt, "!echo chat text");
          assert.ok(!terminal.screen().text.includes("✓ ! echo chat text"));
        });
        await beat(
          "one local command runs in the foreground; Esc stops it and keeps the draft",
          async () => {
            const requests = provider.requests.length;
            await type(terminal, `!${shellEscape.command}`);
            assert.ok(
              terminal.screen().text.includes("enter run locally"),
              "Shell input is identified before submission",
            );
            await press(
              terminal,
              "chat.submit",
              (screen) =>
                screen.lines.some(
                  (line) => line.includes("● !") && line.includes("cd shell-escape &&"),
                ) && screen.text.includes("QA tool heartbeat"),
            );
            await shellEscape.alive();
            assert.ok(idle(terminal.screen()), "No model turn started");
            await type(terminal, "!echo second");
            await press(
              terminal,
              "chat.submit",
              (screen) =>
                screen.text.includes("A local command is running") &&
                composer(screen, "!echo second"),
            );
            assert.equal(provider.requests.length, requests);
            await press(terminal, "chat.quit", emptyComposer);
            await type(terminal, "analyze the result");
            await press(
              terminal,
              "chat.submit",
              (screen) =>
                screen.text.includes("Wait or press Esc") && composer(screen, "analyze the result"),
            );
            assert.equal(
              provider.requests.length,
              requests,
              "A prompt cannot overtake its shell result",
            );
            await press(
              terminal,
              "chat.interrupt",
              (screen) =>
                screen.lines.some(
                  (line) => line.includes("✗ !") && line.includes("cd shell-escape &&"),
                ) && composer(screen, "analyze the result"),
            );
            await shellEscape.stopped(true);
            await press(terminal, "chat.quit", emptyComposer);
            assert.equal(
              provider.requests.length,
              requests,
              "Local cancellation notifies no model",
            );
          },
        );
        await beat("!! output stays out of the next prompt; ! output rides along", async () => {
          await type(terminal, "!!printf 'quiet failure\\n'; exit 7");
          await press(
            terminal,
            "chat.submit",
            (screen) =>
              screen.lines.some(
                (line) =>
                  line.includes("✗ !!") &&
                  line.includes("exit 7") &&
                  line.includes("· not sent to model"),
              ) && screen.text.includes("quiet failure"),
          );
          await type(terminal, "!!seq 1 3");
          await press(
            terminal,
            "chat.submit",
            (screen) =>
              screen.lines.some(
                (line) => line.includes("✓ !! seq 1 3") && line.includes("· not sent to model"),
              ) && composer(screen, ""),
          );
          await press(terminal, "chat.history.previous", (screen) => composer(screen, "!!seq 1 3"));
          await press(terminal, "chat.quit", emptyComposer);
          await type(terminal, "quiet shell");
          await press(
            terminal,
            "chat.submit",
            (screen) => screen.text.includes("Quiet shell answered") && idle(screen),
          );
          const quiet = await provider.waitForRequest((item) => item.script === "quiet shell");
          assert.equal(quiet.prompt, "quiet shell");
          const quietMessages = JSON.stringify(quiet.payload.messages);
          assert.ok(!quietMessages.includes("seq 1 3"));
          assert.ok(!quietMessages.includes("quiet failure"));
          await type(terminal, "!echo kept");
          await press(
            terminal,
            "chat.submit",
            (screen) =>
              screen.lines.some(
                (line) => line.includes("✓ ! echo kept") && !line.includes("not sent"),
              ) && composer(screen, "[Shell echo kept] "),
          );
          await type(terminal, "kept shell", { prefix: "[Shell echo kept] " });
          await press(
            terminal,
            "chat.submit",
            (screen) => screen.text.includes("Kept shell answered") && idle(screen),
          );
          const kept = await provider.waitForRequest((item) => item.script === "kept shell");
          assert.equal(kept.prompt.match(/<shell command=/gu)?.length, 1);
          assert.equal(kept.prompt.match(/\nkept\n<\/shell>/gu)?.length, 1);
          assert.ok(kept.prompt.includes('<shell command="echo kept" exit="0">\nkept\n</shell>'));
          assert.ok(kept.prompt.endsWith("kept shell"));
          assert.ok(
            terminal.screen().lines.some((line) => line.includes(" Shell echo kept ")),
            "The sent prompt folds the shell output back to a tag",
          );
        });
        await beat("a settled thought collapses to head and tail; ctrl+o expands it", async () => {
          await type(terminal, "think hard");
          await press(
            terminal,
            "chat.submit",
            (screen) =>
              screen.text.includes("Thought it through") &&
              screen.text.includes("◆ Thought") &&
              screen.text.includes("… 12 more lines · ctrl+o expand"),
          );
          assert.ok(!terminal.screen().text.includes("QA thought line 5"));
          await press(
            terminal,
            "chat.tools.toggle",
            (screen) =>
              screen.text.includes("Output expanded") && screen.text.includes("QA thought line 5"),
          );
          await terminal.waitForScreen(
            (screen) =>
              screen.lines.filter((line) => line.includes("◆ Thought")).length === 1 &&
              thinking.every((line) => screen.text.includes(line)),
            deadline(),
          );
          await press(
            terminal,
            "chat.tools.toggle",
            (screen) =>
              screen.text.includes("Output collapsed") &&
              !screen.text.includes("QA thought line 5") &&
              screen.text.includes("… 12 more lines · ctrl+o expand"),
          );
        });
        await beat(
          "quit stops local processes; resume restores only submitted shell context",
          async () => {
            const before = provider.requests.length;
            await type(terminal, `!!${shell.command}`);
            await press(
              terminal,
              "chat.submit",
              (screen) =>
                screen.lines.some(
                  (line) => line.includes("● !!") && line.includes("cd shell &&"),
                ) && screen.text.includes("QA tool heartbeat"),
            );
            await shell.alive();
            const resumed = await quit(terminal);
            assert.equal(resumed, sessionId);
            await shell.stopped(true);
            terminal = await reopen([`--session=${sessionId}`]);
            await terminal.waitForScreen(ready, deadline());
            await scrollUntil(
              terminal,
              "chat.scroll.page.up",
              ["Shell echo kept"],
              "Thought it through",
            );
            assert.ok(
              !terminal.screen().text.includes("✓ !! seq 1 3"),
              "Private shell cards are local to the previous TUI",
            );
            assert.equal(provider.requests.length, before, "Resume replays no shell or model work");
            assert.equal(await quit(terminal), sessionId);
          },
        );
      },
    ),
};

export const scenarios: Scenario[] = [short, long, modelSelection, ...cases];
