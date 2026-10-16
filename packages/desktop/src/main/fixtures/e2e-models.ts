import { fakeModels, lastUserText, testModel, titleReply } from "@nyte-ai/host/bench";
import type { Reply } from "@nyte-ai/host/bench";
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

export function e2eModels() {
  return fakeModels({
    id: E2E_PROVIDER,
    name: "E2E",
    models: [testModel(E2E_MODEL.id, { name: "Scripted", provider: E2E_PROVIDER })],
    fallback: (request): Reply => {
      const text = lastUserText(request);

      if (request.context.messages.at(-1)?.role === "toolResult")
        return { content: [{ type: "text", text: "Both agents are working in the background." }] };

      const title = titleReply(request);

      return title === null ? scriptedReply(text) : { content: [{ type: "text", text: title }] };
    },
  });
}

export const models = e2eModels().models;
