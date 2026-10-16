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
} from "@nyte-ai/host/bench";
import type { Reply, Request, Script } from "@nyte-ai/host/bench";
import { contentText, getCurrentTools } from "@nyte-ai/schema/model";
import type { ToolResultMessage } from "@nyte-ai/schema/model";
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
            arguments: { title: "Map the core" },
          },
          {
            type: "toolCall",
            id: "agent-app",
            name: "create",
            arguments: { title: "Map the app" },
          },
        ],
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

function delegationStep(results: readonly ToolResultMessage[]): Reply {
  const created = results.flatMap((result) => {
    const text = result.content
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("");

    const id = /^Created subagent (\S+)\.$/u.exec(text)?.[1];

    return result.toolName === "create" && id !== undefined ? [id] : [];
  });

  if (created.length > 0)
    return {
      content: created.map((session, index) => ({
        type: "toolCall",
        id: `agent-send-${String(index)}`,
        name: "send",
        arguments: { session, prompt: `Trace part ${String(index + 1)}.` },
      })),
    };

  return { content: [{ type: "text", text: "Both agents are working in the background." }] };
}

/** Whether `request` belongs to a chat that opened with scenario D's message. */
function ciChat(request: Request): boolean {
  const first = request.context.messages.find((message) => message.role === "user");

  return first?.role === "user" && contentText(first.content, "") === CI_PROMPT;
}

/**
 * Answers scenario D ("why did CI fail on my PR, fix it") with the bench's
 * script. The route follows the tools the first request lists, as the CI
 * skill tells the model: the CI MCP server's when they are there, else `gh`.
 * Each answered request prints a `NYTE_E2E_CI` line with what the model read
 * last, so a test can check the model saw the failing tail of the job log.
 */
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
      const scripted = ci(request);

      if (scripted !== undefined) return scripted;
      const pick = restaurant(request);

      if (pick !== null) return pick;
      const text = lastUserText(request);

      const answered = request.context.messages.findLastIndex(
        (message) => message.role !== "toolResult",
      );

      const results = request.context.messages
        .slice(answered + 1)
        .flatMap((message) => (message.role === "toolResult" ? [message] : []));

      if (results.length > 0) return delegationStep(results);

      const title = titleReply(request);

      return title === null ? scriptedReply(text) : { content: [{ type: "text", text: title }] };
    },
  });
}

export const models = e2eModels().models;
