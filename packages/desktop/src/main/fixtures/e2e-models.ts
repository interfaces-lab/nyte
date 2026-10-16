import { fakeModels, testModel } from "@nyte-ai/host/bench";
import type { Reply, Request } from "@nyte-ai/host/bench";
import type { ToolResultMessage } from "@nyte-ai/schema/model";
import { TITLE_PROMPT } from "@nyte-ai/plugin/core/rename";
import type { ModelRef } from "@nyte-ai/schema";

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

function lastUserText(request: Request): string {
  const message = request.context.messages.findLast((candidate) => candidate.role === "user");

  if (message?.role !== "user") return "";

  return typeof message.content === "string"
    ? message.content
    : message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

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

function titleRequest(request: Request): boolean {
  const first = request.context.messages[0];

  return first?.role === "system" && first.content === TITLE_PROMPT;
}

export function e2eModels() {
  return fakeModels({
    id: E2E_PROVIDER,
    name: "E2E",
    models: [testModel(E2E_MODEL.id, { name: "Scripted", provider: E2E_PROVIDER })],
    fallback: (request): Reply => {
      const text = lastUserText(request);

      const answered = request.context.messages.findLastIndex(
        (message) => message.role !== "toolResult",
      );

      const results = request.context.messages
        .slice(answered + 1)
        .flatMap((message) => (message.role === "toolResult" ? [message] : []));

      if (results.length > 0) return delegationStep(results);

      if (!titleRequest(request)) return scriptedReply(text);
      const title = (text.split("\n")[0] ?? "").replace(/^User: /u, "");

      return { content: [{ type: "text", text: title }] };
    },
  });
}

export const models = e2eModels().models;
