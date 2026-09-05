/**
 * Fixture conversations for the manual sandbox.
 *
 * A scenario is a workspace plus a script. The script is replayed through the
 * real SDK, so the sessions the TUI opens are produced by the same code path a
 * live run uses — tool calls really execute against the sandbox workspace, and
 * the diffs on the tool cards are real diffs of real files.
 */

/** One model response. A turn needs more than one when the model calls tools. */
export interface ScriptedReply {
  thinking?: string;
  text?: string;
  toolCalls?: readonly { name: string; arguments: Record<string, unknown> }[];
  /** End this reply as a failed request instead of a successful one. */
  fail?: string;
}

export interface ScriptedTurn {
  prompt: string;
  replies: readonly ScriptedReply[];
}

export interface Scenario {
  id: string;
  title: string;
  /** Shown in the sandbox's startup banner. */
  summary: string;
  /** Seeded into the sandbox workspace before the script runs. */
  files: Readonly<Record<string, string>>;
  /** One session per entry, oldest first, so the session picker has depth. */
  sessions: readonly { name: string; turns: readonly ScriptedTurn[] }[];
}

const SAMPLE_SERVER = `import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 8080);

export const server = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  response.writeHead(404);
  response.end();
});

server.listen(port);
`;

export const HEALTH_ROUTE_EDIT = {
  path: "src/server.ts",
  edits: [
    {
      oldText: '  if (request.url === "/health") {',
      newText: '  if (request.url === "/health" && request.method === "GET") {',
    },
  ],
} as const;

const SAMPLE_README = `# fixture workspace

A throwaway project the sandbox scenarios read, grep and edit. Nothing here is
real; it exists so the tool cards in the transcript have real files behind them.
`;

const WORKSPACE_README = `# health-probe

Node HTTP server. Production hits \`GET /health\` and expects JSON \`{ "ok": true }\`.
`;

const LONG_MARKDOWN = [
  "Here is the shape of the change, and why it lands this way.",
  "",
  "## What moved",
  "",
  "The health route used to be matched with a regex that also accepted",
  "`/health/`, `/HEALTH` and `/health?x=1`. Three call sites relied on exactly",
  "one of those spellings, which is how the staging probe ended up green while",
  "the production probe was checking a path that had never existed.",
  "",
  "## The fix",
  "",
  "1. Match the path exactly.",
  "2. Answer `content-type: application/json`, which the probe asserts on.",
  "3. Fall through to 404 for everything else, including the near-misses.",
  "",
  "> The probe was never wrong. It was asking a question the server had two",
  "> answers to, and returning whichever one the router reached first.",
  "",
  "```ts",
  'if (request.url === "/health") {',
  '  response.writeHead(200, { "content-type": "application/json" });',
  "  response.end(JSON.stringify({ ok: true }));",
  "  return;",
  "}",
  "```",
  "",
  "That is the whole diff. The rest of this message is the reasoning I would",
  "otherwise have thrown away, kept here so the scrollback has something long",
  "enough to actually scroll through when you are testing the transcript.",
].join("\n");

function paragraphs(count: number): string {
  return Array.from(
    { length: count },
    (_, index) =>
      `${String(index + 1)}. A wrapped paragraph long enough to exercise reflow, ` +
      "soft wrapping and the collapsed-tag gutter when the viewport is narrow. " +
      "It repeats on purpose so a scroll through it is easy to follow by eye.",
  ).join("\n\n");
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "tools",
    title: "Tool cards",
    summary:
      "Reads, greps, edits and a bash run — every tool card shape with real files behind it.",
    files: {
      "README.md": SAMPLE_README,
      "src/server.ts": SAMPLE_SERVER,
    },
    sessions: [
      {
        name: "Fix the health route",
        turns: [
          {
            prompt: "the health probe is flaky in prod, take a look at src/server.ts",
            replies: [
              {
                thinking:
                  "Read the file before guessing. A flaky probe is usually a route that " +
                  "matches more spellings than the caller thinks it does.",
                text: "Let me read the server and find the health route.",
                toolCalls: [{ name: "read", arguments: { path: "src/server.ts" } }],
              },
              {
                text: "Found it. The route matches exactly, so the flake is upstream of this file — but the response is missing a content type, which the probe asserts on. Let me check who else touches it.",
                // Four consecutive calls: one more than the group's tail
                // window, so the collapsed "earlier calls" row shows up.
                toolCalls: [
                  { name: "bash", arguments: { command: "rg -n health src" } },
                  { name: "ls", arguments: { path: "." } },
                  { name: "bash", arguments: { command: "rg --files -g '*.ts'" } },
                  { name: "bash", arguments: { command: "rg -n server src" } },
                ],
              },
              { text: LONG_MARKDOWN },
            ],
          },
          {
            prompt: "apply it",
            replies: [
              {
                text: "Applying the exact-match fix.",
                toolCalls: [{ name: "edit", arguments: { ...HEALTH_ROUTE_EDIT } }],
              },
              { text: "Done. The route now answers `GET /health` only." },
            ],
          },
          {
            prompt: "run the file to be sure it still parses",
            replies: [
              {
                toolCalls: [
                  { name: "bash", arguments: { command: "node --check src/server.ts && echo ok" } },
                ],
              },
              { text: "Parses clean." },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "workspace",
    title: "Empty workspace",
    summary: "The health-probe files and no sessions, for a live coding pass.",
    files: {
      "README.md": WORKSPACE_README,
      "src/server.ts": SAMPLE_SERVER,
    },
    sessions: [],
  },
  {
    id: "long",
    title: "Long thread",
    summary:
      "A deep scrollback with thinking blocks and wrapped prose, for scroll and collapse testing.",
    files: { "README.md": SAMPLE_README },
    sessions: [
      {
        name: "Long scrollback",
        turns: Array.from({ length: 8 }, (_, index) => ({
          prompt: `explain step ${String(index + 1)} in detail`,
          replies: [
            {
              thinking: `Working through step ${String(index + 1)}. ${paragraphs(2)}`,
              text: `## Step ${String(index + 1)}\n\n${paragraphs(4)}`,
            },
          ],
        })),
      },
      {
        name: "Short follow-up",
        turns: [
          {
            prompt: "one line answer please",
            replies: [{ text: "Exact-match the route and set the content type." }],
          },
        ],
      },
    ],
  },
  {
    id: "errors",
    title: "Failures",
    summary:
      "A failed tool call and a failed request, so the error surfaces have something to render.",
    files: { "README.md": SAMPLE_README },
    sessions: [
      {
        name: "Things that went wrong",
        turns: [
          {
            prompt: "read a file that does not exist",
            replies: [
              {
                text: "Reading it now.",
                toolCalls: [{ name: "read", arguments: { path: "does/not/exist.ts" } }],
              },
              { text: "That path does not exist in this workspace." },
            ],
          },
          {
            prompt: "now fail the request itself",
            replies: [{ fail: "upstream returned 529: overloaded" }],
          },
        ],
      },
    ],
  },
];

export function findScenario(id: string): Scenario {
  const scenario = SCENARIOS.find((candidate) => candidate.id === id);
  if (scenario === undefined) {
    const known = SCENARIOS.map((candidate) => candidate.id).join(", ");
    throw new Error(`Unknown scenario "${id}". Known scenarios: ${known}`);
  }
  return scenario;
}
