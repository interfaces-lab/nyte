import { expect, test } from "vitest";
import { asId } from "@nyte-ai/schema";
import type { Json, Message, SessionView, ToolClass, ToolPartState } from "@nyte-ai/sdk";
import type { ToolMessage } from "@nyte-ai/plugin/client/presentation";
import { settledTool } from "../../test/view-fixtures.ts";
import { subagentActivity } from "./subagent-status.ts";
import { sessionActivityProjector } from "./session-activity.ts";

function readActivity(
  view: Pick<SessionView, "messages">,
  cwd: string | undefined,
): string | undefined {
  return subagentActivity(sessionActivityProjector()(view), cwd);
}

const read = settledTool("read", { kind: "read", path: "/workspace/src/live.ts" });

const call = {
  call: read.state.call,
  name: read.state.name,
  args: read.state.args,
  class: read.state.class,
} satisfies Pick<ToolPartState, "call" | "name" | "args" | "class">;

const running: ToolMessage = {
  ...read,
  state: { ...call, phase: "running", progress: null },
  status: { kind: "live", run: null },
};

const calling: ToolMessage = { ...running, state: { ...call, phase: "calling" } };

const writing: Message = {
  ...read,
  id: asId<"message">("writing"),
  part: asId<"part">("writing"),
  partKind: "text",
  role: "answer",
  state: { markdown: "A response is arriving.", signature: null },
  status: { kind: "live", run: null },
};

test.each([calling, running])("an open $state.phase call names its activity", (message) => {
  expect(readActivity({ messages: [message] }, "/workspace")).toBe("Reading live.ts");
});

test("the latest open call wins over earlier activity", () => {
  const latest: ToolMessage = {
    ...running,
    id: asId<"message">("latest"),
    part: asId<"part">("latest"),
    state: { ...running.state, class: { kind: "shell", command: "pnpm test" } },
  };

  expect(readActivity({ messages: [running, writing, latest] }, "/workspace")).toBe(
    "Running pnpm test",
  );
});

test.each([
  { kind: "waiting", run: asId<"run">("run"), on: { kind: "part", part: asId<"part">("input") } },
  { kind: "waiting", run: asId<"run">("run"), on: { kind: "timer", until: 10 } },
  { kind: "settled", commit: asId<"commit">("committed"), endedAt: 10 },
] satisfies readonly ToolMessage["status"][])(
  "an open call with $kind status still names its running activity",
  (status) => {
    expect(readActivity({ messages: [{ ...running, status }, writing] }, "/workspace")).toBe(
      "Reading live.ts",
    );
  },
);

test.each(["provider", "aborted"] as const)(
  "an open call interrupted by %s falls back to live response text",
  (failureClass) => {
    const failed: ToolMessage = {
      ...running,
      status: { kind: "failed", run: null, failure: { class: failureClass, message: "Stopped" } },
    };

    expect(readActivity({ messages: [writing, failed] }, "/workspace")).toBe("Writing a response");
  },
);

test("settled outcomes do not displace thinking or writing", () => {
  const failed = {
    ...read,
    id: asId<"message">("failed"),
    part: asId<"part">("failed"),
    state: {
      ...call,
      phase: "settled",
      outcome: { kind: "failed", message: "exit 1" },
      changes: null,
    },
  } satisfies ToolMessage;

  expect(readActivity({ messages: [writing, read, failed] }, "/workspace")).toBe(
    "Writing a response",
  );
  expect(
    readActivity({ messages: [{ ...writing, partKind: "thinking" }, read, failed] }, "/workspace"),
  ).toBe("Thinking");
  expect(readActivity({ messages: [read, failed] }, "/workspace")).toBeUndefined();
});

test("unknown tool states cannot masquerade as open tool activity", () => {
  const states: readonly Json[] = [
    null,
    false,
    42,
    "running",
    [],
    {},
    { phase: "running" },
    { ...call, phase: "unknown" },
    { ...call, phase: "running", progress: null, class: { kind: "unknown" } },
    { ...call, phase: "running", progress: "invalid" },
  ];
  const unknown = states.map((state, index) => ({
    ...running,
    id: asId<"message">(`unknown-${String(index)}`),
    part: asId<"part">(`unknown-${String(index)}`),
    state,
  }));

  expect(readActivity({ messages: [running, ...unknown] }, "/workspace")).toBe("Reading live.ts");
  expect(readActivity({ messages: [...unknown, writing] }, "/workspace")).toBe(
    "Writing a response",
  );
  expect(readActivity({ messages: [writing, ...unknown] }, "/workspace")).toBeUndefined();
});

test("a running call remains discoverable behind many settled tool outputs", () => {
  const settled = Array.from({ length: 200 }, (_, index) =>
    settledTool(
      `done-${String(index)}`,
      { kind: "shell", command: "pnpm check" },
      "Output\n".repeat(1_000),
    ),
  );

  expect(readActivity({ messages: [calling, ...settled] }, "/workspace")).toBe("Reading live.ts");
  expect(readActivity({ messages: [writing, ...settled] }, "/workspace")).toBe(
    "Writing a response",
  );
});

test("replacing a message snapshot refreshes its activity as the call settles and resumes", () => {
  const project = sessionActivityProjector();

  expect(subagentActivity(project({ messages: [calling, writing] }), "/workspace")).toBe(
    "Reading live.ts",
  );
  expect(subagentActivity(project({ messages: [running, writing] }), "/workspace")).toBe(
    "Reading live.ts",
  );
  expect(subagentActivity(project({ messages: [read, writing] }), "/workspace")).toBe(
    "Writing a response",
  );
  const resumed: ToolMessage = {
    ...running,
    state: {
      ...call,
      class: { kind: "read", path: "/workspace/src/resumed.ts" },
      phase: "running",
      progress: null,
    },
  };
  expect(subagentActivity(project({ messages: [resumed, writing] }), "/workspace")).toBe(
    "Reading resumed.ts",
  );
});

test("a replaced live envelope controls the fallback even when its state is unknown", () => {
  const project = sessionActivityProjector();

  expect(subagentActivity(project({ messages: [writing] }), "/workspace")).toBe(
    "Writing a response",
  );
  const unknown: Message = { ...writing, partKind: "plugin", state: { phase: "running" } };
  expect(subagentActivity(project({ messages: [unknown] }), "/workspace")).toBeUndefined();
  const thinking: Message = { ...writing, partKind: "thinking", state: null };
  expect(subagentActivity(project({ messages: [thinking] }), "/workspace")).toBe("Thinking");
  expect(subagentActivity(project({ messages: [{ ...writing, state: null }] }), "/workspace")).toBe(
    "Writing a response",
  );
});

test("replacement tool metadata is validated without changing the previous activity", () => {
  const project = sessionActivityProjector();
  const toolClass = { kind: "shell", command: "pnpm before" } satisfies ToolClass;
  const message: ToolMessage = {
    ...running,
    state: { ...call, class: toolClass, phase: "running", progress: null },
  };
  const loaded = project({ messages: [message] });
  const changed: ToolMessage = {
    ...message,
    state: { ...message.state, class: { ...toolClass, command: "pnpm after" } },
  };

  expect(subagentActivity(loaded, "/workspace")).toBe("Running pnpm before");
  expect(subagentActivity(project({ messages: [changed] }), "/workspace")).toBe(
    "Running pnpm after",
  );
  expect(subagentActivity(loaded, "/workspace")).toBe("Running pnpm before");
  const invalid: Message = { ...changed, state: { ...changed.state, progress: "invalid" } };
  expect(subagentActivity(project({ messages: [invalid] }), "/workspace")).toBeUndefined();
  expect(subagentActivity(project({ messages: [message] }), "/workspace")).toBe(
    "Running pnpm before",
  );
});

test("removed messages stop contributing activity and the next view can restore them", () => {
  const project = sessionActivityProjector();

  expect(subagentActivity(project({ messages: [running] }), "/workspace")).toBe("Reading live.ts");
  expect(subagentActivity(project({ messages: [] }), "/workspace")).toBeUndefined();
  expect(subagentActivity(project({ messages: [writing] }), "/workspace")).toBe(
    "Writing a response",
  );
  expect(subagentActivity(project({ messages: [running] }), "/workspace")).toBe("Reading live.ts");
  expect(subagentActivity(undefined, "/workspace")).toBeUndefined();
});
