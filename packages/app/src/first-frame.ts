/**
 * What the last connected run saw of its host, kept so the next launch draws
 * a new chat, its model and the sidebar before the host answers. The seeded
 * queries carry `dataUpdatedAt: 0`, so any live answer outranks them and
 * replaces them in place.
 */
import type { HostId, ModelCatalogView, SessionInfo, WorkspaceInfo } from "@nyte-ai/sdk";
import { ModelCatalogViewType, SessionInfoType, WorkspaceInfoType } from "@nyte-ai/schema";
import type { Decoded } from "@nyte-ai/schema";
import { hashKey } from "@tanstack/react-query";
import type { Query } from "@tanstack/react-query";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { keys, queryClient } from "./queries.ts";
import { directoryWatch } from "./sdk.tsx";

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
  },
  { additionalProperties: false },
);

type FirstFrame = Decoded<typeof FirstFrameType>;

const SEEDED_KEYS = [keys.modelCatalog("initial"), keys.workspaces, keys.firstFrameRoots];

let seededHostId: string | undefined;

let written: string | null = null;

let recording = false;

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

function forget(): void {
  written = null;

  try {
    localStorage.removeItem(FIRST_FRAME_KEY);
  } catch {}
}

/**
 * Seed the catalog, the folders and the recent chats from the last run on
 * `host`, and answer whether there was one. Runs before the first render; a
 * missing, unreadable or foreign snapshot is forgotten and the shell starts
 * empty.
 */
export function seedFirstFrame(host: string): boolean {
  const stored = readStored();
  const frame = parseFrame(stored, host);

  if (frame === undefined) {
    if (stored !== null) forget();

    return false;
  }

  written = stored;
  seededHostId = frame.hostId;
  queryClient.setQueryData(keys.modelCatalog("initial"), frame.catalog, { updatedAt: 0 });
  queryClient.setQueryData(keys.workspaces, frame.workspaces, { updatedAt: 0 });
  queryClient.setQueryData(keys.firstFrameRoots, frame.sessions, { updatedAt: 0 });

  return true;
}

function seeded(query: Query): boolean {
  return (
    query.state.dataUpdatedAt === 0 && SEEDED_KEYS.some((key) => hashKey(key) === query.queryHash)
  );
}

/** The newest catalog any generation answered, live or seeded. */
function newestCatalog(): ModelCatalogView | undefined {
  const newest = queryClient
    .getQueryCache()
    .findAll({ queryKey: ["catalog", "models"] })
    .filter((query) => query.state.data !== undefined)
    .toSorted((left, right) => right.state.dataUpdatedAt - left.state.dataUpdatedAt)
    .at(0);

  return newest === undefined
    ? undefined
    : queryClient.getQueryData<ModelCatalogView>(newest.queryKey);
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

function write(host: string, hostId: HostId): void {
  const catalog = newestCatalog();
  const workspaces = queryClient.getQueryData<readonly WorkspaceInfo[]>(keys.workspaces);
  const directory = directoryWatch("all").value;

  if (catalog === undefined || workspaces === undefined || directory === undefined) return;

  const next = JSON.stringify({
    host,
    hostId,
    catalog,
    workspaces,
    sessions: recentRoots(directory),
  } satisfies FirstFrame);

  if (next === written) return;

  try {
    localStorage.setItem(FIRST_FRAME_KEY, next);
    written = next;
  } catch {}
}

/**
 * Keep this run's view of `host` for the next launch. A connection to
 * another host than the one seeded drops the seed at once. Writes happen
 * only when the page hides or goes away, the moments a later launch reads
 * from, and only when something changed.
 */
export function recordFirstFrame(host: string, hostId: HostId): void {
  if (seededHostId !== undefined && seededHostId !== hostId) {
    seededHostId = undefined;
    forget();
    void queryClient.resetQueries({ predicate: seeded });
  }

  if (queryClient.getQueryState(keys.workspaces)?.dataUpdatedAt === 0)
    void queryClient.invalidateQueries({ queryKey: keys.workspaces, exact: true });

  if (recording) return;
  recording = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") write(host, hostId);
  });
  window.addEventListener("pagehide", () => write(host, hostId));
}
