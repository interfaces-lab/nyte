import { chatOnly } from "@nyte-ai/bench";
import type { Plugin } from "@nyte-ai/core";
import { asId } from "@nyte-ai/schema";
import type { SessionId } from "@nyte-ai/sdk";
import { openTestHost } from "../../test/fixture/host.ts";
import type { TestHost } from "../../test/fixture/host.ts";
import type { Reply } from "@nyte-ai/bench";
import {
  answerText,
  BIG_FILE,
  bigAfter,
  bigBefore,
  STREAM_TOKENS,
  streamedText,
} from "./content.ts";
import { seedChat } from "./seed.ts";

export const SCENARIOS = [
  "cold",
  "typing",
  "streaming",
  "diff",
  "resize",
  "idle",
  "welcome",
  "soak",
] as const;

export type Scenario = (typeof SCENARIOS)[number];

export const HISTORY: Readonly<Record<Scenario, number>> = {
  cold: 0,
  typing: 500,
  streaming: 50,
  diff: 50,
  resize: 500,
  idle: 500,
  welcome: 0,
  soak: 50,
};

/** Turns `soak` streams into one session, measuring memory after each. */
export const SOAK_TURNS = 30;

const SOAK_FIRST = 1000;

/** The reply to soak turn `turn`, and what its last line shows once painted. */
export function soakReply(turn: number): { readonly reply: Reply; readonly shown: string } {
  const index = SOAK_FIRST + turn;

  return {
    reply: {
      content: [{ type: "text", text: answerText(index) }],
      tokens: 200,
      timing: { deltaMs: 1 },
    },
    shown: `step${String(index)}(input`,
  };
}

export const STREAM_DELTA_MS = 2;

export const STREAM_END = "step11(input";

export const DIFF_END = "That is the whole change.";

/** What a resumed chat's last turn shows once painted: the table row with its index, which both apps keep on screen. */
export function loadedText(turns: number): string {
  return `│ ${String(turns - 1)}`;
}

export interface World extends AsyncDisposable {
  readonly fixture: TestHost;
  readonly session: SessionId | null;
}

export async function openWorld(turns: number): Promise<World> {
  const fixture = await openTestHost({
    environment: bigFileEnvironment("chat-only"),
    plugins: [bigFileEnvironment("local")],
  });
  const session = turns === 0 ? null : await seedChat(fixture, turns);

  return { fixture, session, [Symbol.asyncDispose]: () => fixture.close() };
}

export function parseScenario(value: string | undefined): Scenario {
  const found = SCENARIOS.find((scenario) => scenario === value);

  if (found === undefined) throw new Error(`Name a scenario: ${SCENARIOS.join(", ")}.`);

  return found;
}

export function scriptStream(fixture: TestHost): void {
  fixture.reply({
    content: [{ type: "text", text: streamedText() }],
    tokens: STREAM_TOKENS,
    timing: { deltaMs: STREAM_DELTA_MS },
  });
}

export function scriptDiff(fixture: TestHost): void {
  fixture.reply(
    {
      content: [
        {
          type: "toolCall",
          id: "call-diff",
          name: "write",
          arguments: { path: BIG_FILE, content: bigAfter() },
        },
      ],
      stopReason: "toolUse",
    },
    { content: [{ type: "text", text: DIFF_END }] },
  );
}

function bigFileEnvironment(kind: string): Plugin<"core"> {
  const base = chatOnly.environment;

  if (base === undefined) throw new Error("chatOnly provides no environment.");

  return {
    id: `bench-environment-${kind}`,
    environment: {
      kind,
      inspect: (target) => base.inspect(target),
      async attach(target) {
        const env = await base.attach(target);

        return {
          ...env,
          files: {
            ...env.files,
            read: async (path) => ({
              kind: "text",
              path,
              scope: "workspace",
              mime: "text/plain",
              contents: bigBefore(),
              encoding: "utf8",
              version: asId("v1"),
            }),
            write: async () => ({ kind: "saved", version: asId("v2") }),
          },
        };
      },
    },
  };
}
