import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import {
  CI_PROMPT,
  ciScript,
  fakeModels,
  lastToolText,
  lastUserText,
  testModel,
  titleReply,
} from "@nyte-ai/bench";
import type { Block, Reply, Request, Script } from "@nyte-ai/bench";
import { contentText, getCurrentTools } from "@nyte-ai/schema/model";
import type { ModelRef } from "@nyte-ai/schema";
import { restaurantReplies, restaurantSkill } from "@nyte-ai/app/e2e/scenario-u-fixture";

export const E2E_PROVIDER = "e2e";

export const E2E_MODEL: ModelRef = { provider: E2E_PROVIDER, id: "scripted" };

export const MARKDOWN_REPLY = `# Release notes

A paragraph with **bold**, _italic_, ~~struck~~ text, \`inline code\` and a [link](https://example.test/docs).

## Lists

- First item
- Second item with a nested list
  - Nested item
- [x] A done task
- [ ] An open task

1. Ordered one
2. Ordered two

## Code

\`\`\`ts
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
\`\`\`

## Table

| Column | Value |
| ------ | ----- |
| alpha  | 1     |
| beta   | 2     |

> A quoted line.

---

Final paragraph.
`;

function paragraphs(count: number): string {
  return Array.from(
    { length: count },
    (_, index) =>
      `Paragraph ${index + 1} of ${count}. The quick brown fox jumps over the lazy dog while the transcript keeps scrolling.`,
  ).join("\n\n");
}

export const SWARM_AGENTS = 5;

export function scriptedReply(text: string): Reply {
  const [command = "", argument] = text.trim().split(/\s+/, 2);

  switch (command) {
    case "/hold":
      return { hold: true, content: [{ type: "text", text: "Holding until you stop." }] };
    case "/error":
      return { error: "The provider refused this request." };
    case "/think":
      return {
        content: [
          { type: "thinking", thinking: "Weighing the options before answering." },
          { type: "text", text: "Thought about it: the answer is 42." },
        ],
      };
    case "/markdown":
      return { content: [{ type: "text", text: MARKDOWN_REPLY }], tokens: 24 };
    case "/agents":
      return {
        content: [
          {
            type: "toolCall",
            id: "agent-core",
            name: "create",
            arguments: { title: "Map the core", prompt: "Trace part 1." },
          },
          {
            type: "toolCall",
            id: "agent-app",
            name: "create",
            arguments: { title: "Map the app", prompt: "Trace part 2." },
          },
        ],
      };
    case "/swarm":
      return {
        content: Array.from({ length: SWARM_AGENTS }, (_, index): Block => ({
          type: "toolCall",
          id: `agent-survey-${String(index + 1)}`,
          name: "create",
          arguments: {
            title: `Survey part ${String(index + 1)}`,
            prompt: `Survey part ${String(index + 1)}.`,
          },
          deltas: 4,
        })),
        timing: { deltaMs: 150 },
      };
    case "/long": {
      const count = Number.parseInt(argument ?? "", 10);

      return {
        content: [{ type: "text", text: paragraphs(Number.isNaN(count) ? 12 : count) }],
        tokens: 48,
      };
    }

    default:
      return text.startsWith("Child ")
        ? { content: [{ type: "text", text: "An agent reported back." }] }
        : { content: [{ type: "text", text: `Echo: ${text}` }] };
  }
}

const SURVEY_ROUNDS = 8;

function renderReply(request: Request): Reply | undefined {
  const first = request.context.messages.find((message) => message.role === "user");

  if (first?.role !== "user" || contentText(first.content, "") !== "/render-change")
    return undefined;
  const title = titleReply(request);

  if (title !== null) return { content: [{ type: "text", text: title }] };
  const text = lastUserText(request);
  const wrote = request.context.messages.at(-1)?.role === "toolResult";

  if (text === "/render-change" && !wrote)
    return {
      content: [
        {
          type: "toolCall",
          id: "render-write",
          name: "write",
          arguments: { path: "render-proof.txt", content: "render proof\n" },
        },
      ],
    };

  return {
    content: [{ type: "text", text: wrote ? paragraphs(40) : `Echo: ${text}` }],
    tokens: 48,
    timing: { deltaMs: 40 },
  };
}

/** A `/swarm` agent: each round streams its notes and reads a file, so it commits every round as a working agent does; then it answers. */
function surveyReply(request: Request): Reply | undefined {
  const prompt = request.context.messages
    .flatMap((message) => (message.role === "user" ? [contentText(message.content, "")] : []))
    .find((text) => text.startsWith("Survey part "));

  if (prompt === undefined) return undefined;
  const round = request.context.messages.filter((message) => message.role === "toolResult").length;
  const timing = { deltaMs: 25 };

  if (round >= SURVEY_ROUNDS)
    return { content: [{ type: "text", text: paragraphs(4) }], tokens: 80, timing };

  return {
    content: [
      { type: "thinking", thinking: `Planning step ${String(round + 1)} of ${prompt}` },
      { type: "text", text: paragraphs(2) },
      {
        type: "toolCall",
        id: `survey-read-${String(round + 1)}`,
        name: "read",
        arguments: { path: `survey/step-${String(round + 1)}.md` },
      },
    ],
    tokens: 60,
    timing,
  };
}

function ciChat(request: Request): boolean {
  const first = request.context.messages.find((message) => message.role === "user");

  return first?.role === "user" && contentText(first.content, "") === CI_PROMPT;
}

function ciAnswer(): (request: Request) => Reply | undefined {
  let turns: Script | undefined;

  return (request) => {
    if (!ciChat(request)) return undefined;

    if (request.context.messages.at(-1)?.role === "user") {
      const listed = getCurrentTools(request.context.messages).some(
        (tool) => tool.name === "mcp__ci__list_check_runs",
      );

      turns = ciScript({
        skill: join(homedir(), ".agents", "skills", "ci-triage", "SKILL.md"),
        route: listed ? "mcp" : "gh",
      });
    }

    if (turns === undefined) return undefined;
    const last = request.context.messages.at(-1);
    const read = lastToolText(request);

    console.log(
      `NYTE_E2E_CI ${JSON.stringify({
        tool: last?.role === "toolResult" ? last.toolName : (last?.role ?? null),
        chars: read.length,
        clipped: read.includes("characters cut from the middle"),
        head: read.slice(0, 160),
        tail: read.slice(-1_000),
      })}`,
    );

    return turns.answer(request);
  };
}

export function e2eModels() {
  const ci = ciAnswer();

  const restaurant = restaurantReplies({
    skill: restaurantSkill(homedir()),
    origin: process.env.NYTE_E2E_PLACES_ORIGIN,
    log: true,
  });

  return fakeModels({
    id: E2E_PROVIDER,
    name: "E2E",
    models: [testModel(E2E_MODEL.id, { name: "Scripted", provider: E2E_PROVIDER })],
    fallback: (request): Reply => {
      const rendering = renderReply(request);

      if (rendering !== undefined) return rendering;
      const scripted = ci(request);

      if (scripted !== undefined) return scripted;
      const pick = restaurant(request);

      if (pick !== null) return pick;
      const survey = surveyReply(request);

      if (survey !== undefined) return survey;
      const text = lastUserText(request);

      if (request.context.messages.at(-1)?.role === "toolResult")
        return { content: [{ type: "text", text: "Both agents are working in the background." }] };

      const title = titleReply(request);

      return title === null ? scriptedReply(text) : { content: [{ type: "text", text: title }] };
    },
  });
}

export const models = e2eModels().models;
