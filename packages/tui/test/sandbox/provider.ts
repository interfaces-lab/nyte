/**
 * A local stand-in for a model provider, so live turns in the sandbox stream
 * for real without a network or an API key.
 *
 * It speaks the `openai-completions` wire format, which is what the sandbox
 * model's catalog entry declares. Nothing in `packages/tui/src` knows this
 * exists — the bundled binary reaches it only because the seeded catalog
 * points the model's `baseUrl` at this port.
 *
 * What you type steers the reply, so a manual session can reach every
 * transcript surface on demand:
 *
 *   "bash ..."   -> a bash tool call
 *   "read ..."   -> a read tool call
 *   "think ..."  -> a reasoning block before the answer
 *   "long ..."   -> a long markdown answer worth scrolling
 *   "fail ..."   -> a 500, to see the error surface
 *   "slow ..."   -> a deliberately slow stream, to test interrupting mid-run
 *
 * Natural prompts about the health-probe files also run a short coding
 * session (read, restrict to GET, syntax-check) so `qa:show` is not a
 * prefix tour.
 */
import { createServer } from "node:http";
import type { Server } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { HEALTH_ROUTE_EDIT } from "./scenarios.ts";

interface Reply {
  thinking?: string;
  text?: string;
  tool?: { name: string; arguments: Record<string, unknown> };
  /** Milliseconds between chunks. Slow replies are the ones worth interrupting. */
  pace: number;
}

const LONG_ANSWER = [
  "## What I found",
  "",
  "Three things, in the order they matter.",
  "",
  "1. The route matched more spellings than the caller assumed.",
  "2. The probe asserted on a header the handler never set.",
  "3. Staging and production disagreed because they hit different spellings.",
  "",
  "### Why it stayed hidden",
  "",
  "Each half of the system was self-consistent. The probe was correct about",
  "what it wanted, and the router was correct about what it was asked. The",
  "disagreement only existed in the gap between them, which is exactly the",
  "place no test was looking.",
  "",
  "```ts",
  'if (request.url === "/health" && request.method === "GET") {',
  '  response.writeHead(200, { "content-type": "application/json" });',
  "  response.end(JSON.stringify({ ok: true }));",
  "  return;",
  "}",
  "```",
  "",
  "### What I would do next",
  "",
  "Assert the content type in the probe's own test, so the next person who",
  "loosens the handler finds out from CI instead of from a pager.",
].join("\n");

function codingSessionReply(prompt: string): Reply | undefined {
  const text = prompt.toLowerCase();
  if (text.includes("node --check") || (text.includes("parse") && text.includes("file"))) {
    return {
      tool: { name: "bash", arguments: { command: "node --check src/server.ts && echo ok" } },
      pace: 12,
    };
  }
  if (/\bget\b/.test(text) && (text.includes("only") || text.includes("restrict"))) {
    return {
      thinking: "They want GET only. The branch is path-only. Add a method check.",
      text: "I'll restrict it to GET.",
      tool: { name: "edit", arguments: { ...HEALTH_ROUTE_EDIT } },
      pace: 14,
    };
  }
  if (text.includes("flak") || text.includes("matching any method") || text.includes("too loose")) {
    return {
      thinking:
        "A flaky probe usually means the handler accepts more than the checker sends. " +
        "Read the route before changing it.",
      text: "I'll read the handler.",
      tool: { name: "read", arguments: { path: "src/server.ts" } },
      pace: 14,
    };
  }
  return undefined;
}

function replyFor(prompt: string): Reply {
  const text = prompt.toLowerCase();
  if (text.startsWith("bash")) {
    return {
      text: "Running that now.",
      tool: { name: "bash", arguments: { command: prompt.slice(4).trim() || "ls -la" } },
      pace: 12,
    };
  }
  if (text.startsWith("read")) {
    return {
      text: "Reading it.",
      tool: { name: "read", arguments: { path: prompt.slice(4).trim() || "README.md" } },
      pace: 12,
    };
  }
  if (text.startsWith("think")) {
    return {
      thinking:
        "Weighing two readings of the question before answering. The first is " +
        "literal and cheap. The second is what was probably meant, and costs a " +
        "little more to check. Checking the second.",
      text: "Here is the answer, with the reasoning above it.",
      pace: 14,
    };
  }
  // A compaction request carries the whole summary template; answer it with a
  // summary short enough that the card's heading stays on screen.
  if (text.includes("## progress")) {
    return { text: "The health route now answers GET only; the file parses.", pace: 8 };
  }
  if (text.startsWith("long")) return { text: LONG_ANSWER, pace: 8 };
  if (text.startsWith("slow")) return { text: LONG_ANSWER, pace: 160 };
  return (
    codingSessionReply(prompt) ?? {
      text: `You said: ${prompt}\n\nType \`bash\`, \`read\`, \`think\`, \`long\`, \`slow\` or \`fail\` to steer the reply.`,
      pace: 14,
    }
  );
}

/** A tool argument as text; anything that is not a string reads as empty. */
function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value : "";
}

function afterToolReply(name: string, args: Record<string, unknown>): Reply {
  if (name === "read") {
    const path = stringArg(args, "path");
    if (path.includes("server.ts")) {
      return {
        text:
          "The `/health` branch has no method check. POST, HEAD, anything hits it. " +
          "The probe is a GET.",
        pace: 12,
      };
    }
  }
  if (name === "edit") {
    return { text: "The handler answers `GET /health` only.", pace: 12 };
  }
  if (name === "bash") {
    const command = stringArg(args, "command");
    if (command.includes("node --check")) {
      return { text: "It parses.", pace: 12 };
    }
  }
  return { text: "Done.", pace: 12 };
}

function chunk(delta: Record<string, unknown>, finish: string | null): string {
  return `data: ${JSON.stringify({
    id: "chatcmpl-sandbox",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "uji-sandbox",
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`;
}

/**
 * What the request is asking for: the user's newest prompt, or the turn
 * continuing after a tool result, which wants text back rather than the
 * prompt re-read and the tool called again.
 */
type Turn =
  | { kind: "prompt"; text: string }
  | { kind: "after_tool"; name: string; arguments: Record<string, unknown> };

function toolCallFromMessage(
  message: object,
): { name: string; arguments: Record<string, unknown> } | undefined {
  if (!("tool_calls" in message)) return undefined;
  const { tool_calls: calls } = message as { tool_calls?: unknown };
  if (!Array.isArray(calls) || calls.length === 0) return undefined;
  const last = calls[calls.length - 1];
  if (typeof last !== "object" || last === null || !("function" in last)) return undefined;
  const fn = (last as { function?: { name?: unknown; arguments?: unknown } }).function;
  if (fn === undefined || typeof fn.name !== "string") return undefined;
  let args: Record<string, unknown> = {};
  if (typeof fn.arguments === "string") {
    try {
      const parsed: unknown = JSON.parse(fn.arguments);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        args = parsed as Record<string, unknown>;
      }
    } catch {
      args = {};
    }
  }
  return { name: fn.name, arguments: args };
}

function lastTurn(body: string): Turn {
  const empty: Turn = { kind: "prompt", text: "" };
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null || !("messages" in parsed)) return empty;
    const { messages } = parsed as { messages: unknown };
    if (!Array.isArray(messages)) return empty;
    let afterTool = false;
    for (const message of [...messages].reverse()) {
      if (typeof message !== "object" || message === null) continue;
      const { role, content } = message as { role?: unknown; content?: unknown };
      if (role === "tool") {
        afterTool = true;
        continue;
      }
      if (afterTool) {
        const call = toolCallFromMessage(message);
        return {
          kind: "after_tool",
          name: call?.name ?? "",
          arguments: call?.arguments ?? {},
        };
      }
      if (role !== "user") continue;
      if (typeof content === "string") return { kind: "prompt", text: content };
      if (!Array.isArray(content)) continue;
      const text = content
        .flatMap((part) =>
          typeof part === "object" && part !== null && "text" in part
            ? [String((part as { text: unknown }).text)]
            : [],
        )
        .join("");
      return { kind: "prompt", text };
    }
  } catch {
    return empty;
  }
  return empty;
}

/** The mock's next stream for a chat-completions body. Visible so tests lock the coding-session replies. */
export function sandboxReplyFor(body: string): Reply {
  const turn = lastTurn(body);
  return turn.kind === "after_tool"
    ? afterToolReply(turn.name, turn.arguments)
    : replyFor(turn.text);
}

export function startMockProvider(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server: Server = createServer((request, response) => {
    if (!request.url?.endsWith("/chat/completions")) {
      response.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    request.on("data", (part: Buffer) => chunks.push(part));
    request.on("end", () => {
      void (async () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const turn = lastTurn(body);
        if (turn.kind === "prompt" && turn.text.toLowerCase().startsWith("fail")) {
          response.writeHead(500, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: { message: "sandbox: deliberate failure" } }));
          return;
        }
        const reply = sandboxReplyFor(body);
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        response.write(chunk({ role: "assistant" }, null));

        for (const word of (reply.thinking ?? "").match(/\S+\s*/gu) ?? []) {
          response.write(chunk({ reasoning_content: word }, null));
          await delay(reply.pace);
        }
        for (const word of (reply.text ?? "").match(/\S+\s*|\n/gu) ?? []) {
          response.write(chunk({ content: word }, null));
          await delay(reply.pace);
        }
        if (reply.tool !== undefined) {
          response.write(
            chunk(
              {
                tool_calls: [
                  {
                    index: 0,
                    id: `call_${String(Date.now())}`,
                    type: "function",
                    function: {
                      name: reply.tool.name,
                      arguments: JSON.stringify(reply.tool.arguments),
                    },
                  },
                ],
              },
              null,
            ),
          );
        }
        response.write(chunk({}, reply.tool === undefined ? "stop" : "tool_calls"));
        response.write("data: [DONE]\n\n");
        response.end();
      })();
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({
        baseUrl: `http://127.0.0.1:${String(port)}/v1`,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
