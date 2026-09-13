import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { composer, deadline, press, quit, ready, session, type } from "./drive.ts";
import type { InputRecord, Scenario, Screen } from "./types.ts";

/** The pending block names its lane until its turn begins; the admitted turn has no such row. */
const awaitingAdmission = (screen: Screen) => screen.text.includes("ctrl+q pending");

/** Admission must not relocate a submitted message or disturb the next draft. */
export const steerHandoff: Scenario = {
  name: "rendering.steer-handoff",
  covers: [
    "fake transcript",
    "pending steer to user message",
    "draft preservation during delivery",
  ],
  run: (context) => {
    const prompt = "Review the settings panel";
    const correction = "Only change the spacing, not the colors.";
    const draft = "Keep the keyboard shortcuts too.";
    const fixtureHoldMs = 1_000;
    const rowsWith = (screen: Screen) =>
      screen.lines.flatMap((line, index) => (line.includes(correction) ? [index + 1] : []));
    return session(
      context,
      {
        height: 24,
        steps: [
          {
            name: "fake review",
            prompt,
            action: {
              kind: "hold",
              text: [
                "## Settings panel review",
                "",
                "The model picker and account controls share the same panel.",
                "",
                "- The heading sits too close to the first control.",
                "- The account rows need consistent vertical spacing.",
                "- The footer already lines up with the composer.",
                "",
                "I am checking the remaining controls before making changes.",
              ].join("\n"),
            },
          },
          {
            name: "fake steered reply",
            prompt: correction,
            // Keep the next answer empty so its growth cannot cause the handoff's row movement.
            action: { kind: "hold", text: "" },
          },
        ],
      },
      async ({ terminal, provider }) => {
        await terminal.waitForScreen(ready, deadline());
        await type(terminal, prompt);
        await press(terminal, "chat.submit", (screen) =>
          screen.text.includes("I am checking the remaining controls"),
        );
        const review = await provider.waitForRequest((request) => request.script === "fake review");
        await provider.waitForStage(review.id, "held");

        await type(terminal, correction);
        if (context.show) await setTimeout(1_000);
        const before = terminal.screen();
        // Every observed frame from Enter to admission, as rows holding the message: one row, never moving.
        const frames: { readonly at: number; readonly rows: readonly number[] }[] = [];
        const stopObserving = terminal.observe((screen) => {
          if (composer(screen, correction)) return;
          frames.push({ at: performance.now(), rows: rowsWith(screen) });
        });
        let submit: InputRecord;
        let pending: Screen;
        let landed: Screen;
        let pendingAt: number;
        let releasedAt: number;
        let landedAt: number;
        try {
          submit = terminal.key("chat.submit");
          pending = await terminal.waitForScreen(
            (screen) => !composer(screen, correction) && rowsWith(screen).length > 0,
            deadline(),
            submit,
          );
          pendingAt = performance.now();
          assert.equal(rowsWith(pending).length, 1);
          assert.ok(awaitingAdmission(pending));

          await type(terminal, draft);
          // This delay belongs to the fake provider, not a claim about Nyte's input latency.
          await setTimeout(fixtureHoldMs);
          releasedAt = performance.now();
          provider.release(review.id);
          landed = await terminal.waitForScreen(
            (screen) =>
              composer(screen, draft) &&
              screen.text.includes("Worked") &&
              !awaitingAdmission(screen) &&
              rowsWith(screen).length > 0,
            deadline(),
            submit,
          );
          landedAt = performance.now();
        } finally {
          stopObserving();
        }
        assert.equal(rowsWith(landed).length, 1);

        await Promise.all([
          writeFile(join(context.cwd, "steer-before.txt"), `${before.text}\n`),
          writeFile(join(context.cwd, "steer-pending.txt"), `${pending.text}\n`),
          writeFile(join(context.cwd, "steer-transcript.txt"), `${landed.text}\n`),
          writeFile(
            join(context.cwd, "steer-handoff.json"),
            JSON.stringify(
              {
                fixtureHoldMs,
                enterToPendingMs: submit.latencyMs,
                pendingToTranscriptMs: landedAt - pendingAt,
                providerReleaseToTranscriptMs: landedAt - releasedAt,
                rows: { pending: rowsWith(pending)[0], transcript: rowsWith(landed)[0] },
                frames: frames.map((frame) => ({
                  afterEnterMs: frame.at - submit.at,
                  rows: frame.rows,
                })),
              },
              null,
              2,
            ),
          ),
        ]);
        const steered = await provider.waitForRequest(
          (request) => request.script === "fake steered reply",
        );
        await provider.waitForStage(steered.id, "held");
        assert.equal(steered.prompt, correction);
        assert.equal(
          steered.payload.messages.filter((message) => message.role === "user").length,
          2,
        );
        if (context.show) await setTimeout(1_000);
        assert.deepEqual(
          rowsWith(landed),
          rowsWith(pending),
          "Admission must keep the submitted message on the same screen row",
        );
        assert.ok(frames.length > 0, "The handoff painted no observed frame");
        assert.deepEqual(
          frames.map((frame) => frame.rows).filter((rows) => rows.length !== 1),
          [],
          "Every observed frame between Enter and admission shows the message exactly once",
        );
        assert.deepEqual(
          [...new Set(frames.map((frame) => frame.rows[0]))],
          rowsWith(pending),
          "The message never changes row between Enter and admission",
        );
        provider.release(steered.id, "I will adjust the spacing and leave the colors alone.");
        await terminal.waitForScreen(
          (screen) =>
            screen.text.includes("I will adjust the spacing") &&
            composer(screen, draft) &&
            ready(screen),
          deadline(),
          submit,
        );
        await press(terminal, "chat.quit", (screen) => !composer(screen, draft));
        await quit(terminal);
      },
    );
  },
};
