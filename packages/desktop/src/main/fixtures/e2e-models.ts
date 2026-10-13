/**
 * The offline catalog the e2e build opens the desktop with: one provider,
 * `e2e`, whose model answers from the last user text alone, so a seeded
 * baseline and a live run read the same replies without a network.
 */
import { fakeModels, testModel } from "@nyte-ai/host/bench";
import type { Reply, Request } from "@nyte-ai/host/bench";
import type { ModelRef } from "@nyte-ai/schema";

export const E2E_PROVIDER = "e2e";

export const E2E_MODEL: ModelRef = { provider: E2E_PROVIDER, id: "scripted" };

/** The reply to `/markdown`: one of each construct the transcript renders. */
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

/**
 * Returns the reply for a user text: `/hold` streams one delta then holds
 * until Stop; `/error` fails the turn; `/think` streams thinking then text;
 * `/markdown` streams `MARKDOWN_REPLY`; `/long <n>` streams `n` paragraphs
 * token by token; anything else answers `Echo: <text>`.
 */
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
    case "/long": {
      const count = Number.parseInt(argument ?? "", 10);

      return {
        content: [{ type: "text", text: paragraphs(Number.isNaN(count) ? 12 : count) }],
        tokens: 48,
      };
    }
    default:
      return { content: [{ type: "text", text: `Echo: ${text}` }] };
  }
}

/** Returns the offline catalog: provider `e2e` with the one model `E2E_MODEL`, answering every request with `scriptedReply` of its last user text. */
export function e2eModels() {
  return fakeModels({
    id: E2E_PROVIDER,
    name: "E2E",
    models: [testModel(E2E_MODEL.id, { name: "Scripted", provider: E2E_PROVIDER })],
    fallback: (request) => scriptedReply(lastUserText(request)),
  });
}

export const models = e2eModels().models;
