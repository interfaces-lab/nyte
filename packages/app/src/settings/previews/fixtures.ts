import type { SessionInfo } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";

const PREVIEW_NOW = Date.now();

const WORKSPACE = asId<"workspace">("preview");

export const PREVIEW_PATH = "~/Developer/nyte";

export function previewChat(id: string, name: string, age: number): SessionInfo {
  return {
    id: asId<"session">(id),
    name,
    parent: null,
    call: null,
    workspace: WORKSPACE,
    pinned: false,
    archived: false,
    activation: { kind: "active" },
    heads: [
      {
        name: asId<"head">("main"),
        tip: { kind: "commit", id: asId<"commit">(id) },
        stack: null,
        execution: { kind: "idle", lastRun: null },
        unread: false,
        background: { working: 0, waiting: 0 },
      },
    ],
    createdAt: PREVIEW_NOW - age,
    lastActivityAt: PREVIEW_NOW - age,
  };
}
