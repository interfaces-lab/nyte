import type { Execution, SessionId, SessionInfo } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import type { RailRows } from "../../chrome/sidebar-rows.tsx";

export const PREVIEW_NOW = Date.now();

const WORKSPACE = asId<"workspace">("preview");

export const PREVIEW_PATH = "~/Developer/nyte";

export const PREVIEW_PLACE = { workspace: WORKSPACE, path: PREVIEW_PATH };

const IDLE: Execution = { kind: "idle", lastRun: null };

/** Sidebar rows that act on nothing: the preview slot is inert. */
export function previewRail(activeSessionId?: SessionId): RailRows {
  return {
    openWorkspace: null,
    activeSessionId,
    unavailable: new Set(),
    repository: undefined,
    working: new Set(),
    showUpdated: true,
    open: () => undefined,
    rename: () => undefined,
    pin: () => undefined,
    archive: () => undefined,
    remove: () => undefined,
    openDraft: () => undefined,
    removeDraft: () => undefined,
  };
}

/** A chat in the preview workspace whose last activity was `age` milliseconds ago. */
export function previewChat(
  id: string,
  name: string,
  age: number,
  execution: Execution = IDLE,
): SessionInfo {
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
        execution,
        unread: false,
      },
    ],
    createdAt: PREVIEW_NOW - age,
    lastActivityAt: PREVIEW_NOW - age,
  };
}
