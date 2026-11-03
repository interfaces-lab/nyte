import { asId } from "@nyte-ai/schema";
import type { Infer } from "@nyte-ai/schema";
import { describe, expect, it } from "vitest";
import { isPart, tool } from "../src/index.ts";
import type { ToolDefinition } from "../src/index.ts";
import { fakeModels, open } from "./fake-models.ts";
import { echo, events, nothing } from "./turn-support.ts";

const CALLS = 24;

const fan: ToolDefinition<Infer<typeof nothing>> = {
  name: "fan",
  description: "Call echo many times at once, as a codemode script does.",
  parameters: nothing,
  class: () => ({ kind: "custom", label: "Fanning out" }),
  replay: "safe",
  async execute(_args, invocation) {
    const outcomes = await Promise.all(
      Array.from({ length: CALLS }, (_, index) =>
        invocation.tools.execute("echo", { text: `${index}` }, { key: `${index}` }),
      ),
    );

    return {
      content: [{ kind: "text", text: outcomes.map((outcome) => outcome.kind).join(",") }],
    };
  },
};

describe("parallel tool calls", () => {
  it("parallel tool calls in one request all settle", async () => {
    const fake = fakeModels();

    fake.reply(
      { content: [{ type: "toolCall", id: "call-fan", name: "fan", arguments: {} }] },
      { content: [{ type: "text", text: "Done." }] },
    );

    await using host = await open(fake, {
      plugins: [{ id: "tools", contribute: { tools: [echo, fan] } }],
    });

    const id = asId<"session">("parallel");
    const logged = events(host.kernel, id);
    const { session, receipt } = await host.sessions.start({ id, content: "Go." });
    const end = await receipt.settled();

    expect(end).toMatchObject({ kind: "completed" });

    const parts = (await session.view()).messages.filter((message) => isPart(message, tool));

    expect(
      parts.flatMap((message) =>
        message.state.phase === "settled" && message.state.outcome.kind === "ok"
          ? []
          : [
              [
                message.id,
                message.state.phase === "settled" ? message.state.outcome : message.state.phase,
              ],
            ],
      ),
    ).toEqual([]);
    expect(parts).toHaveLength(CALLS + 1);
    expect(
      logged.filter((event) => event.kind === "call" && event.change === "settled"),
    ).toHaveLength(CALLS + 1);
  });
});
