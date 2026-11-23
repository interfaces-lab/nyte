import { appendFileSync, existsSync, watch } from "node:fs";
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
  const text = params.prompt.findLast((block) => block.type === "text")?.text ?? "";

  log({ prompt: text, session: params.sessionId, pid: process.pid });

  if (text === "charge-once") {
    const countFile = `${cwds.get(params.sessionId)}/effect`;
    const prior = existsSync(countFile);
    appendFileSync(countFile, "charged\n");

    if (!prior) await new Promise(() => {});
  }

  if (text === "child-first") {
    say("child", "RESULT-EARLY");
    update(params.sessionId, {
      sessionUpdate: "subagent_update",
      sessionId: "child",
      title: "Reader",
      state: { state: "running" },
    });
    update(params.sessionId, {
      sessionUpdate: "subagent_update",
      sessionId: "child",
      state: { state: "idle", stopReason: "end_turn" },
    });
  }

  if (text === "child-fail") {
    update(params.sessionId, {
      sessionUpdate: "subagent_update",
      sessionId: "child",
      title: "Reader",
      state: { state: "running" },
    });
    update(params.sessionId, {
      sessionUpdate: "subagent_update",
      sessionId: "child",
      state: { state: "idle", stopReason: "refusal" },
    });
    update(params.sessionId, {
      sessionUpdate: "subagent_update",
      sessionId: "child",
      title: "Renamed",
    });
  }

  if (text === "block-policy") {
    await new Promise((resolve) => {
      const watcher = watch(cwds.get(params.sessionId), (_, file) => {
        if (file === "release") {
          watcher.close();
          resolve();
        }
      });

      log({ gate: "policy" });
    });
    log({ acted: process.argv.at(-1) });
  }

  if (text.startsWith("repeat")) {
    update(params.sessionId, {
      sessionUpdate: "tool_call",
      toolCallId: "same",
      title: `Lookup ${text}`,
      kind: "read",
      status: "completed",
      rawOutput: text,
    });
  }

  if (text === "parallel") {
    update(params.sessionId, {
      sessionUpdate: "tool_call",
      toolCallId: "a",
      title: "First",
      kind: "read",
      status: "pending",
    });
    await ask(params.sessionId, {
      toolCallId: "b",
      title: "Second",
      kind: "read",
      status: "pending",
    });

    for (const id of ["a", "b"]) {
      update(params.sessionId, {
        sessionUpdate: "tool_call_update",
        toolCallId: id,
        status: "completed",
        rawOutput: `final-${id}`,
      });
    }
  }

  if (text === "incomplete") {
    update(params.sessionId, {
      sessionUpdate: "tool_call",
      toolCallId: "a",
      title: "First",
      kind: "read",
      status: "pending",
    });
  }
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
          agentCapabilities: {
            promptCapabilities: { image: false },
            sessionCapabilities: { resume: {} },
          },
          authMethods: [],
        },
      });
      break;
    case "session/new":
      sessions += 1;
      cwds.set(`s${String(sessions)}`, message.params.cwd);
      send({ id: message.id, result: { sessionId: `s${String(sessions)}` } });
      break;
    case "session/resume":
      cwds.set(message.params.sessionId, message.params.cwd);

      if (process.env.ASTRA_RESUME === "report") {
        say(message.params.sessionId, "PRE-REGISTER-REPORT");
        update(message.params.sessionId, { sessionUpdate: "usage_update", used: 23, size: 1000 });
      }

      send({ id: message.id, result: {} });
      break;
    case "session/prompt":
      if (message.params.prompt.some((b) => b.text === "expired")) {
        send({ id: message.id, error: { code: -32_000, message: "expired" } });
        break;
      }

      send({ id: message.id, result: await prompt(message.params) });

      if (message.params.prompt.some((block) => block.text === "detach")) {
        say(message.params.sessionId, "REPORT-ONE");
        update(message.params.sessionId, {
          sessionUpdate: "usage_update",
          used: 12_000,
          size: 1_000_000,
        });
        say(message.params.sessionId, "REPORT-TWO");
        update(message.params.sessionId, {
          sessionUpdate: "usage_update",
          used: 12_000,
          size: 1_000_000,
        });
      }

      if (message.params.prompt.some((b) => b.text === "idle-ask")) {
        void ask(message.params.sessionId, {
          toolCallId: "orphan",
          title: "Idle command",
          kind: "execute",
          rawInput: { command: "pwd" },
        });
        await ask("unregistered", { toolCallId: "barrier" });
      }

      if (message.params.prompt.some((b) => b.text === "late")) {
        say(message.params.sessionId, "LATE-OLD");
        await ask("unregistered", { toolCallId: "barrier" });
      }

      break;
    case "session/cancel":
      cancels.get(message.params.sessionId)?.();
      break;
    default:
      if (message.id !== undefined) {
        send({
          id: message.id,
          error: { code: -32_601, message: `${message.method} is not handled.` },
        });
      }
  }
}

createInterface({ input: process.stdin })
  .on("line", (line) => void receive(line))
  .on("close", () => process.exit(0));
