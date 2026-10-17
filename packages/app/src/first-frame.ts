/**
 * What the last connected run saw of its host, kept so the next launch draws
 * a new chat, its model, the sidebar and the window's folder before the host
 * answers. Each seed sits under a key of its own that the live query shows as
 * its placeholder, so the live answer replaces it in place and only live
 * answers are recorded.
 */
import type { HostId, SessionInfo, WorkspaceInfo } from "@nyte-ai/sdk";
import {
  idSchema,
  ModelCatalogViewType,
  SessionInfoType,
  WorkspaceInfoType,
} from "@nyte-ai/schema";
import type { Decoded } from "@nyte-ai/schema";
import { hashKey } from "@tanstack/react-query";
import type { Query } from "@tanstack/react-query";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { HostState } from "./bridge.ts";
import { keys, newestModelCatalog, queryClient } from "./queries.ts";
import { directoryWatch } from "./sdk.tsx";
import { sessionId } from "./schemas.ts";
import { activeTab, tabPlace } from "./tabs/model.ts";
import { windowTabs } from "./tabs/window-tabs.ts";

const FIRST_FRAME_KEY = "nyte.first-frame.v1";

const ROOT_LIMIT = 60;

const FirstFrameType = Type.Object(
  {
    /** Whose world this is: `local` for the desktop's own host, the saved connection URL on the web. */
    host: Type.String({ minLength: 1 }),
    /** The host's id when this was recorded; a connection that reports another drops the snapshot. */
    hostId: Type.String({ minLength: 1 }),
    catalog: ModelCatalogViewType,
    workspaces: Type.Array(WorkspaceInfoType),
    /** Pinned and newest open root chats, in the directory's order. */
    sessions: Type.Array(SessionInfoType, { maxItems: ROOT_LIMIT }),
    /**
     * The chat the window's active tab showed and the folder the window had
     * selected for it, so a window reopening on that chat lays out its
     * workbench for the folder on its first frame; null when the tab showed
     * no chat or the chat lives in Home.
     */
    folder: Type.Union([
      Type.Object(
        {
          session: sessionId,
          workspace: Type.Object(
            {
              id: idSchema<"workspace">(),
              path: Type.String({ minLength: 1 }),
              name: Type.String(),
            },
            { additionalProperties: false },
          ),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);

type FirstFrame = Decoded<typeof FirstFrameType>;

const SEEDED_KEYS = [
  keys.host,
  keys.modelCatalog("initial"),
  keys.firstFrameWorkspaces,
  keys.firstFrameRoots,
].map((key) => hashKey(key));

let seededHostId: string | undefined;

/** The connection this run records for; the newest one wins. */
let recording: { readonly host: string; readonly hostId: HostId } | undefined;

function readStored(): string | null {
  try {
    return localStorage.getItem(FIRST_FRAME_KEY);
  } catch {
    return null;
  }
}

function parseFrame(stored: string | null, host: string): FirstFrame | undefined {
  if (stored === null) return undefined;

  try {
    const parsed: unknown = JSON.parse(stored);

    return Value.Check(FirstFrameType, parsed) && parsed.host === host ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Drop the stored snapshot, as when the host behind its connection changed. */
export function forgetFirstFrame(): void {
  try {
    localStorage.removeItem(FIRST_FRAME_KEY);
  } catch {}
}

/**
 * Seed the catalog, the folders, the recent chats and, for a window reopening
 * on the chat it recorded, that chat's folder from the last run on `host`, and
 * answer whether there was one. Runs before the first render, after the
 * window's tabs are restored; a missing, unreadable or foreign snapshot is
 * forgotten and the shell starts empty.
 */
export function seedFirstFrame(host: string): boolean {
  const stored = readStored();
  const frame = parseFrame(stored, host);

  if (frame === undefined) {
    if (stored !== null) forgetFirstFrame();

    return false;
  }

  seededHostId = frame.hostId;
  queryClient.setQueryData(keys.modelCatalog("initial"), frame.catalog, { updatedAt: 0 });
  queryClient.setQueryData(keys.firstFrameWorkspaces, frame.workspaces, { updatedAt: 0 });
  queryClient.setQueryData(keys.firstFrameRoots, frame.sessions, { updatedAt: 0 });
  const place = tabPlace(activeTab(windowTabs.getSnapshot()));

  if (frame.folder !== null && place.kind === "session" && place.sessionId === frame.folder.session)
    queryClient.setQueryData(keys.host, { workspace: frame.folder.workspace } satisfies HostState, {
      updatedAt: 0,
    });

  return true;
}

function seeded(query: Query): boolean {
  return query.state.dataUpdatedAt === 0 && SEEDED_KEYS.includes(query.queryHash);
}

/** Pinned roots and the newest open ones, kept in the directory's newest-first order. */
function recentRoots(directory: readonly SessionInfo[]): readonly SessionInfo[] {
  const roots = directory.filter((session) => session.parent === null && !session.archived);
  const pinned = roots.filter((session) => session.pinned);

  const kept = new Set([
    ...pinned,
    ...roots.filter((session) => !session.pinned).slice(0, ROOT_LIMIT - pinned.length),
  ]);

  return roots.filter((session) => kept.has(session)).slice(0, ROOT_LIMIT);
}

/** The window's folder for the chat its active tab shows, or null. */
function windowFolder(): FirstFrame["folder"] {
  const place = tabPlace(activeTab(windowTabs.getSnapshot()));
  const workspace = queryClient.getQueryData<HostState>(keys.host)?.workspace;

  return place.kind === "session" && workspace !== undefined
    ? { session: place.sessionId, workspace }
    : null;
}

function write(): void {
  const catalog = newestModelCatalog();
  const workspaces = queryClient.getQueryData<readonly WorkspaceInfo[]>(keys.workspaces);
  const directory = directoryWatch("all").value;

  if (recording === undefined || catalog === undefined) return;

  if (workspaces === undefined || directory === undefined) return;

  try {
    localStorage.setItem(
      FIRST_FRAME_KEY,
      JSON.stringify({
        ...recording,
        catalog,
        workspaces,
        sessions: recentRoots(directory),
        folder: windowFolder(),
      } satisfies FirstFrame),
    );
  } catch {}
}

/**
 * Keep this run's view of `host` for the next launch. A connection to
 * another host than the one seeded drops the seed at once. Writes happen
 * only when the page hides or goes away, the moments a later launch reads
 * from.
 */
export function recordFirstFrame(host: string, hostId: HostId): void {
  if (seededHostId !== undefined && seededHostId !== hostId) {
    seededHostId = undefined;
    forgetFirstFrame();
    void queryClient.resetQueries({ predicate: seeded });
  }

  if (recording === undefined) {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") write();
    });
    window.addEventListener("pagehide", write);
  }

  recording = { host, hostId };
}
