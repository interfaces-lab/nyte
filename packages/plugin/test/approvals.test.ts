import { isPart, tool } from "@nyte-ai/core";
import type { Plugin, ToolDefinition } from "@nyte-ai/core";
import { memoryStore } from "@nyte-ai/core/store";
import { standard } from "@nyte-ai/schema";
import type { SessionId } from "@nyte-ai/schema";
import { Type } from "typebox";
import { assert, describe, expect, it } from "vitest";
import approvalsPlugin, { approvalReason, decideApproval } from "../src/approvals/approvals.ts";
import { openApprovals, PERMISSIONS } from "../src/approvals/schema.ts";
import type { ApprovalPolicy } from "../src/approvals/schema.ts";
import { fakeModels, open, until } from "./fake-models.ts";
import type { FakeModels, Reply } from "./fake-models.ts";

const ran: string[] = [];

const save = {
  name: "save",
  description: "Save a file.",
  parameters: standard(Type.Object({ path: Type.String() })),
  class: (args) => ({ kind: "edit", path: args.path }),
  replay: "never",
  execute: async (args) => {
    ran.push(`save ${args.path}`);

    return { content: [{ kind: "text", text: `Wrote ${args.path}.` }] };
  },
} satisfies ToolDefinition<{ path: string }>;

const shell = {
  name: "shell",
  description: "Run a command.",
  parameters: standard(Type.Object({ command: Type.String() })),
  class: (args) => ({ kind: "shell", command: args.command }),
  replay: "never",
  execute: async (args) => {
    ran.push(`shell ${args.command}`);

    return { content: [{ kind: "text", text: `Ran ${args.command}.` }] };
  },
} satisfies ToolDefinition<{ command: string }>;

const tools: Plugin<"core"> = { id: "tools", contribute: { tools: [save, shell] } };

const plugins = [approvalsPlugin, tools];

function calls(...list: readonly (readonly [string, Record<string, string>])[]): Reply {
  return {
    content: list.map(([name, args], index) => ({
      type: "toolCall",
      id: `${name}-${index}`,
      name,
      arguments: args,
    })),
  };
}

const done: Reply = { content: [{ type: "text", text: "Done." }] };

function results(fake: FakeModels, request: number): readonly string[] {
  return (fake.requests[request]?.context.messages ?? []).flatMap((message) =>
    message.role === "toolResult"
      ? message.content.flatMap((block) => (block.type === "text" ? [block.text] : []))
      : [],
  );
}

async function waiting(
  session: { view(): Promise<Parameters<typeof openApprovals>[0]> },
  count = 1,
) {
  return until(async () => {
    const pending = openApprovals(await session.view());

    return pending.length >= count ? pending : undefined;
  });
}

async function started(policy: ApprovalPolicy, fake: FakeModels, store = memoryStore()) {
  const host = await open(fake, plugins, { store, poll: 10 });
  expect(await host.settings.apply(PERMISSIONS, policy)).toEqual({ kind: "applied" });

  return host;
}

function edit(path: string) {
  return { name: "write", class: { kind: "edit", path } as const };
}

describe("approvalReason", () => {
  const cwd = "/tmp/project";
  const command = { name: "bash", class: { kind: "shell", command: "ls" } as const };
  const read = { name: "read", class: { kind: "read", path: "/etc/hosts" } as const };
  const mcp = { name: "mcp__db__drop", class: { kind: "custom", label: "Dropping" } as const };
  const search = { ...mcp, name: "web_search", approval: "never" as const };
  const readOnly = { ...mcp, name: "mcp__db__list" };

  it.each([
    ["ask", edit("src/a.ts"), "edit"],
    ["ask", edit("../elsewhere.ts"), "outside"],
    ["ask", command, "shell"],
    ["ask", mcp, "tool"],
    ["ask", read, null],
    ["ask", search, null],
    ["ask", readOnly, "tool"],
    ["auto-edit", edit("src/a.ts"), null],
    ["auto-edit", edit("/tmp/project/src/a.ts"), null],
    ["auto-edit", edit("/tmp/project-other/a.ts"), "outside"],
    ["auto-edit", command, "shell"],
    ["auto-edit", mcp, "tool"],
    ["auto-edit", read, null],
    ["full", edit("/etc/passwd"), null],
    ["full", command, null],
    ["full", mcp, null],
  ] as const)("%s gives %o the reason %o", (policy, call, reason) => {
    expect(approvalReason(policy, call, cwd)).toBe(reason);
  });
});

it("asks before an edit under ask, runs it once allowed, and asks again for the next one", async () => {
  ran.length = 0;
  const fake = fakeModels();
  fake.reply(calls(["save", { path: "a.ts" }]), calls(["save", { path: "b.ts" }]), done);
  await using host = await started("ask", fake);
  const { session, receipt } = await host.sessions.start({ content: "Write two files." });

  const [first] = await waiting(session);
  assert(first !== undefined);
  expect(first).toMatchObject({ tool: "save", reason: "edit", class: { path: "a.ts" } });
  expect(ran).toEqual([]);
  expect(await session.part(first.part).act("once", {})).toEqual({ kind: "ok", output: undefined });

  const second = await until(async () =>
    openApprovals(await session.view()).find((pending) => pending.part !== first.part),
  );

  expect(ran).toEqual(["save a.ts"]);
  expect(await session.part(second.part).act("once", {})).toMatchObject({ kind: "ok" });
  expect((await receipt.settled()).kind).toBe("completed");
  expect(ran).toEqual(["save a.ts", "save b.ts"]);
  expect(results(fake, 1)).toEqual(["Wrote a.ts."]);
});

it("runs workspace edits under auto-edit but asks for shell commands and edits outside", async () => {
  ran.length = 0;
  const fake = fakeModels();
  fake.reply(
    calls(
      ["save", { path: "src/a.ts" }],
      ["save", { path: "/etc/hosts" }],
      ["shell", { command: "ls" }],
    ),
    done,
  );
  await using host = await started("auto-edit", fake);
  const { session, receipt } = await host.sessions.start({ content: "Go." });

  const asked = await waiting(session, 2);
  expect(asked.map((pending) => [pending.tool, pending.reason])).toEqual([
    ["save", "outside"],
    ["shell", "shell"],
  ]);
  expect(ran).toEqual(["save src/a.ts"]);

  for (const pending of asked) await session.part(pending.part).act("once", {});
  expect((await receipt.settled()).kind).toBe("completed");
  expect(ran.toSorted()).toEqual(["save /etc/hosts", "save src/a.ts", "shell ls"]);
});

it("never asks under full access", async () => {
  ran.length = 0;
  const fake = fakeModels();
  fake.reply(calls(["save", { path: "/etc/hosts" }], ["shell", { command: "rm -rf build" }]), done);
  await using host = await started("full", fake);
  const { session, receipt } = await host.sessions.start({ content: "Go." });

  expect((await receipt.settled()).kind).toBe("completed");
  expect(ran.toSorted()).toEqual(["save /etc/hosts", "shell rm -rf build"]);
  expect((await session.view()).parts.filter((part) => part.partKind === "ask/approval")).toEqual(
    [],
  );
});

it("gives the model a clear rejection when the user denies, and does not run the tool", async () => {
  ran.length = 0;
  const fake = fakeModels();
  fake.reply(calls(["shell", { command: "rm -rf /" }]), done);
  await using host = await started("ask", fake);
  const { session, receipt } = await host.sessions.start({ content: "Clean up." });

  const [asked] = await waiting(session);
  assert(asked !== undefined);
  expect(await session.part(asked.part).act("deny", {})).toMatchObject({ kind: "ok" });
  expect((await receipt.settled()).kind).toBe("completed");
  expect(ran).toEqual([]);
  expect(results(fake, 1)).toEqual([
    "The tool call was rejected: The user denied this tool call. Ask them how to proceed instead of retrying it.",
  ]);

  const call = (await session.view()).messages.find((message) => isPart(message, tool));
  assert(call !== undefined && isPart(call, tool) && call.state.phase === "settled");
  expect(call.state.outcome).toMatchObject({ kind: "rejected" });
});

it("allows a tool for the session: answers its other waiting calls and skips the next ones", async () => {
  ran.length = 0;
  const fake = fakeModels();
  fake.reply(
    calls(["shell", { command: "ls" }], ["shell", { command: "pwd" }]),
    calls(["shell", { command: "date" }]),
    done,
  );
  await using host = await started("ask", fake);
  const { session, receipt } = await host.sessions.start({ content: "Look around." });

  const [first] = await waiting(session, 2);
  assert(first !== undefined);
  expect(await session.part(first.part).act("session", {})).toMatchObject({ kind: "ok" });
  expect((await receipt.settled()).kind).toBe("completed");
  expect(ran.toSorted()).toEqual(["shell date", "shell ls", "shell pwd"]);
  expect(openApprovals(await session.view())).toEqual([]);
  expect(
    (await session.view()).parts.filter((part) => part.partKind === "ask/approval"),
  ).toHaveLength(2);
});

it("keeps a pending approval across a host restart and finishes the call on the new host", async () => {
  ran.length = 0;
  const store = memoryStore();
  const before = fakeModels();
  before.reply(calls(["shell", { command: "make" }]));
  let id: SessionId;
  let part;

  {
    await using host = await started("ask", before, store);
    const { session } = await host.sessions.start({ content: "Build it." });
    id = session.id;
    const [asked] = await waiting(session);
    assert(asked !== undefined);
    part = asked.part;
  }

  const after = fakeModels();
  after.reply(done);
  await using reopened = await open(after, plugins, { store, poll: 10 });
  const session = reopened.session(id);

  expect(openApprovals(await session.view())).toMatchObject([{ part, tool: "shell" }]);
  expect(await session.part(part).act("once", {})).toMatchObject({ kind: "ok" });
  await until(async () => {
    const execution = (await session.view()).execution;

    return execution.kind === "idle" && execution.lastRun !== null ? execution : undefined;
  });
  expect(ran).toEqual(["shell make"]);
  expect(results(after, 0)).toEqual(["Ran make."]);
});

it("takes the first answer when two clients answer one approval", async () => {
  ran.length = 0;
  const store = memoryStore();
  const fake = fakeModels();
  fake.reply(calls(["shell", { command: "deploy" }]), done);

  await using desktop = await started("ask", fake, store);

  await using terminal = await open(fakeModels(), plugins, {
    store,
    poll: 10,
    execution: { kind: "admit-only" },
  });

  const { session, receipt } = await desktop.sessions.start({ content: "Ship it." });
  const [asked] = await waiting(session);
  assert(asked !== undefined);
  const watching = terminal.session(session.id);
  expect(openApprovals(await watching.view())).toMatchObject([{ part: asked.part }]);

  expect(await watching.part(asked.part).act("once", {})).toMatchObject({ kind: "ok" });
  expect(await session.part(asked.part).act("deny", {})).toEqual({
    kind: "rejected",
    reason: "This approval was already answered.",
  });
  expect((await receipt.settled()).kind).toBe("completed");
  expect(ran).toEqual(["shell deploy"]);
  expect(
    (await session.view()).parts.find((candidate) => candidate.id === asked.part)?.state,
  ).toMatchObject({ decision: "once" });
});

it("decides a call outside the agent loop for Claude Code's canUseTool", async () => {
  await using host = await open(fakeModels(), [approvalsPlugin]);
  const { session } = await host.sessions.start({ content: "Hi." });
  const bash = { name: "Bash", class: { kind: "shell", command: "ls" } as const };
  const signal = new AbortController().signal;

  expect(await decideApproval(session.id, bash, signal)).toEqual({ kind: "allow" });
  expect(await host.settings.apply(PERMISSIONS, "ask")).toEqual({ kind: "applied" });

  const deciding = decideApproval(session.id, bash, signal);
  const [asked] = await waiting(session);
  assert(asked !== undefined);
  await session.part(asked.part).act("deny", {});
  expect(await deciding).toEqual({
    kind: "deny",
    reason: "The user denied this tool call. Ask them how to proceed instead of retrying it.",
  });

  const stop = new AbortController();
  const stopped = decideApproval(session.id, bash, stop.signal);
  await waiting(session);
  stop.abort();
  expect(await stopped).toEqual({
    kind: "deny",
    reason: "The approval request closed before the user answered.",
  });
  expect(openApprovals(await session.view())).toEqual([]);
});
