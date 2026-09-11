import assert from "node:assert/strict";
import { beat, command, deadline, footer, press, quit, ready, session, type } from "./drive.ts";
import { bashRequest } from "./provider.ts";
import { FIXTURE_CHILD_MODEL, FIXTURE_MODEL, FIXTURE_PROVIDER } from "./workspace.ts";
import type { Scenario } from "./types.ts";

export const modelSelection: Scenario = {
  name: "models.during-turn",
  covers: [
    "Thinking and model controls stay available during agent turns",
    "Configuration changes leave tool continuations and streaming requests unchanged",
    "The next message uses the selected thinking level",
  ],
  run: (context) =>
    session(context, { reasoning: true }, async ({ terminal, provider, tool }) => {
      const work = await tool("thinking-selection");
      provider.enqueue(
        { ...bashRequest(work.command), prompt: "keep working" },
        {
          name: "original continuation",
          prompt: "keep working",
          action: { kind: "hold", text: "Original turn continues" },
        },
        {
          name: "next message",
          prompt: "use the selected thinking level",
          action: { kind: "reply", text: "Selected thinking level applied" },
        },
      );
      await terminal.waitForScreen(ready, deadline());
      await command(terminal, "effort low", (screen) => footer(screen, FIXTURE_MODEL, "low"));
      await type(terminal, "keep working");
      terminal.key("chat.submit");
      await work.alive();
      const first = await provider.waitForRequest((request) => request.prompt === "keep working");
      assert.equal(first.payload.reasoning_effort, "low");

      await beat("shortcuts and pickers change the next selection while a tool runs", async () => {
        await press(terminal, "chat.thinking.cycle", (screen) =>
          footer(screen, FIXTURE_MODEL, "medium"),
        );
        await press(terminal, "chat.model.next", (screen) =>
          footer(screen, FIXTURE_CHILD_MODEL, "medium"),
        );
        await press(terminal, "chat.model.previous", (screen) =>
          footer(screen, FIXTURE_MODEL, "medium"),
        );
        await command(terminal, "effort high", (screen) => footer(screen, FIXTURE_MODEL, "high"));
        await command(
          terminal,
          "model",
          (screen) =>
            screen.text.includes("Type to search") &&
            screen.text.includes(`${FIXTURE_PROVIDER}/${FIXTURE_MODEL} · High`),
        );
        await press(terminal, "model.decrease", (screen) =>
          screen.text.includes(`${FIXTURE_PROVIDER}/${FIXTURE_MODEL} · Medium`),
        );
        await press(
          terminal,
          "picker.accept",
          (screen) =>
            !screen.text.includes("Type to search") && footer(screen, FIXTURE_MODEL, "medium"),
        );
        await command(terminal, "settings", (screen) => screen.text.includes("Settings"));
        await press(terminal, "picker.close", (screen) => !screen.text.includes("Settings"));
        await work.alive();
        assert.equal(
          provider.requests.filter((request) => request.script !== "automatic conversation title")
            .length,
          1,
          "Changing the selection sends no provider request",
        );
      });

      await work.release();
      const continuation = await provider.waitForRequest(
        (request) => request.script === "original continuation",
      );
      await provider.waitForStage(continuation.id, "held");
      assert.equal(continuation.model, FIXTURE_MODEL);
      assert.equal(continuation.payload.reasoning_effort, "low");
      await terminal.waitForScreen(
        (screen) => screen.text.includes("Original turn continues"),
        deadline(),
      );

      await beat(
        "thinking changes during streaming without interrupting the response",
        async () => {
          await press(terminal, "chat.thinking.cycle", (screen) =>
            footer(screen, FIXTURE_MODEL, "high"),
          );
          provider.release(continuation.id, "Original turn finished");
          await provider.waitForStage(continuation.id, "completed");
          await terminal.waitForScreen(
            (screen) =>
              screen.text.includes("Original turn finished") && screen.text.includes("enter send"),
            deadline(),
          );
          assert.ok(
            !provider.events.some(
              (event) => event.requestId === continuation.id && event.stage === "aborted",
            ),
            "The active response finishes normally",
          );
        },
      );

      await beat("the next message reaches the provider with the selected level", async () => {
        await type(terminal, "use the selected thinking level");
        await press(
          terminal,
          "chat.submit",
          (screen) =>
            screen.text.includes("Selected thinking level applied") &&
            screen.text.includes("enter send"),
        );
        const next = await provider.waitForRequest((request) => request.script === "next message");
        assert.equal(next.model, FIXTURE_MODEL);
        assert.equal(next.payload.reasoning_effort, "high");
        assert.equal(
          provider.requests.filter((request) => request.script !== "automatic conversation title")
            .length,
          3,
        );
      });
      await quit(terminal);
    }),
};
