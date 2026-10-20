import type { Execution, SessionInfo, ToolClass, TurnInfo } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import type { ToolMessage } from "@nyte-ai/plugin/client/presentation";
import type { TurnMessages } from "../src/view-helpers.ts";

export const USAGE = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: null,
  total: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export const COMPLETED: Execution = {
  kind: "idle",
  lastRun: { id: asId<"run">("run"), end: { kind: "completed", usage: USAGE }, endedAt: 2 },
};

export function sessionRow(
  id: string,
  change: Partial<SessionInfo> = {},
  execution: Execution = COMPLETED,
): SessionInfo {
  return {
    id: asId<"session">(id),
    name: id,
    parent: null,
    call: null,
    workspace: asId<"workspace">("fixture"),
    pinned: false,
    archived: false,
    activation: { kind: "active" },
    heads: [
      { name: asId<"head">("main"), tip: { kind: "start" }, stack: null, execution, unread: false },
    ],
    createdAt: 1,
    lastActivityAt: 2,
    ...change,
  };
}

export function settledTool(id: string, toolClass: ToolClass, text = ""): ToolMessage {
  return {
    id: asId<"message">(id),
    turn: asId<"turn">("turn"),
    at: 1,
    kind: "part",
    part: asId<"part">(id),
    partKind: "tool",
    role: "step",
    version: 1,
    state: {
      call: asId<"call">(id),
      name: toolClass.kind,
      args: null,
      class: toolClass,
      phase: "settled",
      outcome: {
        kind: "ok",
        content: text === "" ? [] : [{ kind: "text", text }],
        output: null,
        parts: [],
      },
      changes: null,
    },
    status: { kind: "settled", commit: asId<"commit">(id), endedAt: 2 },
  };
}

export function endedTurn(
  messages: TurnMessages["messages"],
  change: Partial<TurnInfo> = {},
): TurnMessages {
  return {
    info: {
      id: asId<"turn">("turn"),
      run: null,
      prompt: null,
      state: { kind: "ended", end: { kind: "completed", usage: USAGE } },
      startedAt: 1,
      endedAt: 2,
      steps: messages.length,
      thinkingOnly: false,
      summary: {
        byClass: {
          read: { count: 0, paths: [] },
          list: { count: 0, paths: [] },
          edit: { count: 0, paths: [] },
          shell: { count: 0, paths: [] },
          delegate: { count: 0, paths: [] },
          custom: { count: 0, paths: [] },
        },
        failed: 0,
        stopped: 0,
        added: 0,
        removed: 0,
      },
      ...change,
    },
    messages,
  };
}
