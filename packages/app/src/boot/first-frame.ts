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
import type { HostState } from "../contract/bridge.ts";
import { keys, queryClient } from "../data/query-client.ts";
import { newestModelCatalog } from "../data/catalog.ts";
import { chatStore } from "../data/chat-store.ts";
import { sessionList } from "../data/directory.ts";
import { hostWatch } from "../data/watches.ts";
import { sessionId } from "../data/schemas.ts";
import { startupConnection } from "../data/startup.ts";
import { activeTab, tabPlace } from "../tabs/model.ts";
import { windowTabs } from "../tabs/window-tabs.ts";
import { localArea, readStored, removeStored, writeStored } from "../lib/storage.ts";

const FIRST_FRAME_KEY = "nyte.first-frame.v1";

const ROOT_LIMIT = 60;

const FirstFrameType = Type.Object(
  {
    host: Type.String({ minLength: 1 }),
    hostId: Type.String({ minLength: 1 }),
    catalog: ModelCatalogViewType,
    workspaces: Type.Array(WorkspaceInfoType),
    home: Type.Union([idSchema<"workspace">(), Type.Null()]),
    sessions: Type.Array(SessionInfoType, { maxItems: ROOT_LIMIT }),
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
  keys.firstFrameHome,
].map((key) => hashKey(key));

let seededHostId: string | undefined;

let recording: { readonly host: string; readonly hostId: HostId } | undefined;

export function forgetFirstFrame(): void {
  removeStored(localArea(), FIRST_FRAME_KEY);
}

export function seedFirstFrame(host: string): boolean {
  const stored = readStored(localArea(), FIRST_FRAME_KEY, FirstFrameType, null);
  const frame = stored?.host === host ? stored : undefined;

  if (frame === undefined) {
    forgetFirstFrame();

    return false;
  }

  seededHostId = frame.hostId;
  queryClient.setQueryData(keys.modelCatalog("initial"), frame.catalog, { updatedAt: 0 });
  queryClient.setQueryData(keys.firstFrameWorkspaces, frame.workspaces, { updatedAt: 0 });
  queryClient.setQueryData(keys.firstFrameRoots, frame.sessions, { updatedAt: 0 });
  queryClient.setQueryData(keys.firstFrameHome, frame.home, { updatedAt: 0 });
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

function recentRoots(directory: readonly SessionInfo[]): readonly SessionInfo[] {
  const roots = directory.filter((session) => session.parent === null && !session.archived);
  const pinned = roots.filter((session) => session.pinned);

  const kept = new Set([
    ...pinned,
    ...roots.filter((session) => !session.pinned).slice(0, ROOT_LIMIT - pinned.length),
  ]);

  return roots.filter((session) => kept.has(session)).slice(0, ROOT_LIMIT);
}

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
  const directory = sessionList("roots").value;
  const host = hostWatch("host").value;

  if (recording === undefined || catalog === undefined) return;

  if (workspaces === undefined || directory === undefined || host === undefined) return;

  writeStored(localArea(), FIRST_FRAME_KEY, {
    ...recording,
    catalog,
    workspaces,
    home: host.defaultWorkspace,
    sessions: recentRoots(directory),
    folder: windowFolder(),
  } satisfies FirstFrame);
}

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

const CONTENT_WAIT_MS = 2_000;

export async function windowContentReady(): Promise<void> {
  const place = tabPlace(activeTab(windowTabs.getSnapshot()));
  const noContent = Promise.withResolvers<void>();

  const check = (): void => {
    const kind = startupConnection.read().kind;

    if (kind === "failed" || kind === "unreachable" || kind === "migrating") noContent.resolve();
  };

  const leave = startupConnection.subscribe(check);
  const limit = setTimeout(noContent.resolve, CONTENT_WAIT_MS);
  check();

  try {
    await Promise.race([
      noContent.promise,
      Promise.all([
        queryClient.getQueryData(keys.firstFrameRoots) === undefined
          ? sessionList("roots").first()
          : undefined,
        place.kind === "session" ? chatStore(place.sessionId).first() : undefined,
      ]),
    ]);
  } finally {
    clearTimeout(limit);
    leave();
  }
}
