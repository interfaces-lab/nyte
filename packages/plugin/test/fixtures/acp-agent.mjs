import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const log = (entry) => {
  if (process.env.ACP_LOG) appendFileSync(process.env.ACP_LOG, `${JSON.stringify(entry)}\n`);
};

const send = (message) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);

const pending = new Map();

const cancels = new Map();

let next = 0;

let sessions = 0;

const cwds = new Map();

const request = (method, params) =>
  new Promise((resolve) => {
    next += 1;
    pending.set(next, resolve);
    send({ id: next, method, params });
  });

const update = (sessionId, body) =>
  send({ method: "session/update", params: { sessionId, update: body } });

const say = (sessionId, text) =>
  update(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text } });

const options = [
  { optionId: "yes", name: "Allow", kind: "allow_once" },
  { optionId: "no", name: "Reject", kind: "reject_once" },
];

async function ask(sessionId, toolCall, choices = options) {
  const response = await request("session/request_permission", {
    sessionId,
    toolCall,
    options: choices,
  });
  const outcome = response.outcome.outcome === "selected" ? response.outcome.optionId : "cancelled";
  log({ permission: toolCall.toolCallId, outcome });

  return outcome;
}

async function tools(sessionId) {
  say(sessionId, "Looking.");
  update(sessionId, {
    sessionUpdate: "tool_call",
    toolCallId: "t1",
    title: "List files",
    kind: "execute",
    status: "pending",
    rawInput: { command: "ls" },
  });
  const first = await ask(sessionId, { toolCallId: "t1" });
  update(sessionId, {
    sessionUpdate: "tool_call_update",
    toolCallId: "t1",
    status: first === "yes" ? "completed" : "failed",
    content: [
      { type: "content", content: { type: "text", text: first === "yes" ? "a.txt" : "denied" } },
    ],
  });

  const second = await ask(sessionId, {
    toolCallId: "t2",
    title: "Delete build",
    kind: "execute",
    rawInput: { command: "rm -rf build" },
  });

  update(sessionId, {
    sessionUpdate: "tool_call_update",
    toolCallId: "t2",
    status: second === "yes" ? "completed" : "failed",
    content: [
      { type: "content", content: { type: "text", text: second === "yes" ? "removed" : "denied" } },
    ],
  });
  say(sessionId, `Done: t1 ${first}, t2 ${second}.`);

  return {
    stopReason: "end_turn",
    usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
  };
}

async function move(sessionId, always) {
  const cwd = cwds.get(sessionId) ?? "/";

  const outcome = await ask(
    sessionId,
    {
      toolCallId: "m1",
      title: "Move notes",
      kind: "move",
      status: "pending",
      locations: [{ path: `${cwd}/notes.txt` }, { path: "/etc/notes.txt" }],
    },
    always
      ? [
          { optionId: "always", name: "Always allow", kind: "allow_always" },
          { optionId: "no", name: "Reject", kind: "reject_once" },
        ]
      : options,
  );

  update(sessionId, {
    sessionUpdate: "tool_call_update",
    toolCallId: "m1",
    status: outcome === "yes" || outcome === "always" ? "completed" : "failed",
  });
  say(sessionId, `Moved: ${outcome}.`);

  return { stopReason: "end_turn" };
}

async function hold(sessionId) {
  say(sessionId, "Working.");
  await new Promise((resolve) => cancels.set(sessionId, resolve));

  return { stopReason: "cancelled" };
}

async function prompt(params) {
  const text = params.prompt.map((block) => (block.type === "text" ? block.text : "")).join("");

  if (text.includes("tools")) return tools(params.sessionId);

  if (text.includes("move")) return move(params.sessionId, text.includes("always"));

  if (text.includes("wait")) return hold(params.sessionId);
  say(params.sessionId, "Hello.");

  return { stopReason: "end_turn" };
}

async function receive(line) {
  if (line.trim() === "") return;
  const message = JSON.parse(line);
  log(message.method === undefined ? { response: message.id } : { method: message.method });

  if (message.method === undefined) {
    pending.get(message.id)?.(message.result);
    pending.delete(message.id);

    return;
  }

  switch (message.method) {
    case "initialize":
      process.stderr.write("fake agent ready\n");
      send({
        id: message.id,
        result: {
          protocolVersion: 1,
          agentCapabilities: { promptCapabilities: { image: false } },
          authMethods: [],
        },
      });
      break;
    case "session/new":
      sessions += 1;
      cwds.set(`s${String(sessions)}`, message.params.cwd);
      send({ id: message.id, result: { sessionId: `s${String(sessions)}` } });
      break;
    case "session/prompt":
      send({ id: message.id, result: await prompt(message.params) });
      break;
    case "session/cancel":
      cancels.get(message.params.sessionId)?.();
      break;
    default:
      if (message.id !== undefined)
        send({
          id: message.id,
          error: { code: -32601, message: `${message.method} is not handled.` },
        });
  }
}

createInterface({ input: process.stdin })
  .on("line", (line) => void receive(line))
  .on("close", () => process.exit(0));
