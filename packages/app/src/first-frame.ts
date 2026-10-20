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
import { sessionsWatch, sessionWatch } from "./sdk.tsx";
import { sessionId } from "./schemas.ts";
import { startupConnection } from "./startup.ts";
import { activeTab, tabPlace } from "./tabs/model.ts";
import { windowTabs } from "./tabs/window-tabs.ts";

const FIRST_FRAME_KEY = "nyte.first-frame.v1";

const ROOT_LIMIT = 60;

const FirstFrameType = Type.Object(
  {
    host: Type.String({ minLength: 1 }),
    hostId: Type.String({ minLength: 1 }),
    catalog: ModelCatalogViewType,
    workspaces: Type.Array(WorkspaceInfoType),
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
].map((key) => hashKey(key));

let seededHostId: string | undefined;

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

export function forgetFirstFrame(): void {
  try {
    localStorage.removeItem(FIRST_FRAME_KEY);
  } catch {}
}

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
  const directory = sessionsWatch("roots").value;

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
  const failed = Promise.withResolvers<void>();

  const check = (): void => {
    if (startupConnection.read().kind === "failed") failed.resolve();
  };

  const leave = startupConnection.subscribe(check);
  const limit = setTimeout(failed.resolve, CONTENT_WAIT_MS);
  check();

  try {
    await Promise.race([
      failed.promise,
      Promise.all([
        queryClient.getQueryData(keys.firstFrameRoots) === undefined
          ? sessionsWatch("roots").first()
          : undefined,
        place.kind === "session" ? sessionWatch(place.sessionId).first() : undefined,
      ]),
    ]);
  } finally {
    clearTimeout(limit);
    leave();
  }
}
