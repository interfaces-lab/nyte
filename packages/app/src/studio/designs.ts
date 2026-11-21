import { useEffect, useEffectEvent, useSyncExternalStore } from "react";
import type { FileEvent, WorkspaceId } from "@nyte-ai/sdk";
import type { SelectedWorkspace } from "../contract/bridge.ts";
import { connected } from "../data/connection.ts";
import { writeDocument } from "../data/documents.ts";
import { filesFor } from "../data/files.ts";
import { carryLight, shine } from "../light/light.ts";
import type { Lights, Subject } from "../light/light.ts";
import { useChatChanges } from "../workbench/editor/chat-changes.ts";
import { shareDocument } from "../workbench/editor/document-channel.ts";
import { createFileDocument } from "../workbench/editor/file-document.ts";
import type { FileBuffer, FileDocumentSnapshot } from "../workbench/editor/file-document.ts";
import { holdDocument, scheduleSave } from "../workbench/editor/file-store.ts";
import { workbenchViewKey } from "../workbench/paths.ts";
import { followAgentLights, designFile } from "./agent-lights.ts";
import { smallestChange } from "./design-source.ts";

/**
 * The workspace's designs, named by path from the workspace root, as the board stamps them on what it draws. The rest
 * of the app names a file by its absolute path, so the two meet in this module only.
 */
export interface Designs {
  /** Every `.jsx` and `.css` file under the workspace's `design` folder, by path from its root, sorted. */
  readonly paths: readonly string[];
  /** The text of each file that has loaded, with this window's unsaved edits in it. */
  readonly texts: ReadonlyMap<string, string>;
}

export interface DesignTrouble {
  readonly path: string;
  readonly status: Extract<FileDocumentSnapshot["status"], { readonly kind: "conflict" | "error" }>;
}

export interface DesignStore {
  useDesigns(): Designs;
  useTroubles(): readonly DesignTrouble[];
  read(design: string): string | undefined;
  edit(design: string, start: number, end: number, text: string): void;
  overwrite(design: string): Promise<void>;
  reload(design: string): Promise<void>;
  save(design: string): Promise<void>;
  shine(subject: Subject | null): void;
  lights(lights: Lights): Lights;
  release(): void;
}

interface Held {
  readonly buffer: FileBuffer;
  readonly unsubscribe: () => void;
  readonly release: () => void;
  scheduled: (() => void) | undefined;
}

interface Opened {
  readonly store: DesignStore;
  readonly designs: () => Designs;
  readonly close: () => void;
  holders: number;
}

const SAVE_MS = 150;

/** The name the board moves the light under, so it draws its own moves without flying the camera to them. */
export const SURFACE = "design";

const EMPTY: Designs = { paths: [], texts: new Map() };

const NO_TROUBLES: readonly DesignTrouble[] = [];

const stores = new Map<WorkspaceId, Opened>();

const watchers = new Set<() => void>();

function announce(): void {
  for (const watcher of watchers) watcher();
}

function watchStores(watcher: () => void): () => void {
  watchers.add(watcher);

  return () => watchers.delete(watcher);
}

export function openDesignStore(workspace: SelectedWorkspace): DesignStore {
  const open = stores.get(workspace.id);

  if (open !== undefined) {
    open.holders += 1;

    return open.store;
  }

  const created = createDesignStore(workspace);
  stores.set(workspace.id, { ...created, holders: 1 });
  announce();

  return created.store;
}

function releaseStore(workspace: WorkspaceId, store: DesignStore): void {
  const open = stores.get(workspace);

  if (open?.store !== store) return;
  open.holders -= 1;

  if (open.holders > 0) return;
  stores.delete(workspace);
  open.close();
  announce();
}

function createDesignStore(workspace: SelectedWorkspace): Omit<Opened, "holders"> {
  const root = workspace.path.replace(/\/$/u, "");
  const view = workbenchViewKey(workspace.path);
  const since = Date.now();
  const listed = new Set<string>();
  const held = new Map<string, Held>();
  const listeners = new Set<() => void>();
  let designs = EMPTY;
  let troubles = NO_TROUBLES;
  let released = false;
  let watching: AsyncIterator<unknown> | undefined;

  const fromRoot = (path: string): string => path.slice(root.length + 1);

  const onDisk = (path: string): string => `${root}/${path}`;

  const relative = (path: string): string => (path.startsWith(`${root}/`) ? fromRoot(path) : path);

  const agents = followAgentLights({
    folder: root,
    readText: (path) => held.get(path)?.buffer.text(),
    since,
  });

  const publish = (): void => {
    const paths = [...listed].map(fromRoot).toSorted();

    const texts = new Map(
      paths.flatMap((design) => {
        const file = held.get(onDisk(design));

        return file === undefined ? [] : [[design, file.buffer.text()] as const];
      }),
    );

    const next = paths.flatMap((design): DesignTrouble[] => {
      const status = held.get(onDisk(design))?.buffer.getSnapshot().status;

      return status?.kind === "conflict" || status?.kind === "error"
        ? [{ path: design, status }]
        : [];
    });

    const same =
      paths.length === designs.paths.length &&
      paths.every((path, index) => path === designs.paths[index]) &&
      texts.size === designs.texts.size &&
      [...texts].every((entry) => designs.texts.get(entry[0]) === entry[1]);

    const calm =
      next.length === troubles.length &&
      next.every(
        (trouble, index) =>
          trouble.path === troubles[index]?.path && trouble.status === troubles[index]?.status,
      );

    if (same && calm) return;

    if (!same) designs = paths.length === 0 ? EMPTY : { paths, texts };

    if (!calm) troubles = next.length === 0 ? NO_TROUBLES : next;

    for (const listener of listeners) listener();
    announce();
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);

    return () => listeners.delete(listener);
  };

  const save = (file: Held): Promise<void> =>
    file.buffer.save({
      write: (input) =>
        writeDocument({
          path: input.path,
          contents: input.contents,
          encoding: input.encoding,
          expect: input.version,
        }),
    });

  const follow = async (): Promise<void> => {
    const events = (await connected()).documents.watch([onDisk("design")])[Symbol.asyncIterator]();

    if (released) {
      void events.return?.();

      return;
    }

    watching = events;
    void scan();

    for (
      let next = await events.next();
      next.done !== true && !released;
      next = await events.next()
    )
      for (const event of next.value) heard(event);
  };

  const scan = async (): Promise<void> => {
    const files = await filesFor(workspace.id);

    for await (const frame of files.scan({ directory: "design", ignored: "include" })) {
      if (released) return;

      if (frame.kind === "entries")
        for (const entry of frame.entries) if (entry.kind === "file") list(onDisk(entry.path));
    }
  };

  const heard = (event: FileEvent): void => {
    if (event.kind === "removed") {
      unlist(event.path);

      return;
    }

    const file = held.get(event.path);

    if (file === undefined) {
      list(event.path);

      return;
    }

    if (file.buffer.getSnapshot().version !== event.version) void refresh(file, event.path);
  };

  const list = (path: string): void => {
    if (released || !path.startsWith(`${root}/`) || !designFile(fromRoot(path)) || listed.has(path))
      return;
    listed.add(path);
    publish();
    void open(path);
  };

  const unlist = (path: string): void => {
    if (!listed.delete(path)) return;
    stop(path);
    publish();
  };

  const open = async (path: string): Promise<void> => {
    const document = await (await connected()).documents.read(path, { as: "document" });

    if (released || !listed.has(path) || held.has(path)) return;

    if (document.kind === "missing") {
      unlist(path);

      return;
    }

    if (document.kind !== "text") return;

    const hold = holdDocument({
      view,
      path,
      holder: "design",
      create: () => createFileDocument(document),
    });

    hold.buffer.observeDisk(document);
    const unshare = shareDocument(path, hold.buffer);

    held.set(path, {
      buffer: hold.buffer,
      unsubscribe: hold.buffer.subscribe(() => changed(path)),
      release: () => {
        unshare();
        hold.release();
      },
      scheduled: undefined,
    });
    publish();
    agents.place();
  };

  const stop = (path: string): void => {
    const file = held.get(path);

    if (file === undefined) return;
    held.delete(path);
    file.unsubscribe();
    const scheduled = file.scheduled;
    file.scheduled = undefined;
    scheduled?.();
    const snapshot = file.buffer.getSnapshot();

    const due =
      scheduled !== undefined &&
      snapshot.dirty &&
      !snapshot.remote &&
      snapshot.status.kind !== "conflict" &&
      snapshot.status.kind !== "error";

    if (!due) {
      file.release();

      return;
    }

    void save(file).finally(file.release);
  };

  const changed = (path: string): void => {
    const file = held.get(path);
    const before = designs.texts.get(fromRoot(path));

    if (file === undefined) return;
    const after = file.buffer.text();

    if (before !== undefined && before !== after) carryLight(path, smallestChange(before, after));
    publish();
    agents.place();
  };

  const refresh = async (file: Held, path: string): Promise<void> => {
    const document = await (await connected()).documents.read(path, { as: "document" });

    if (released || held.get(path) !== file) return;

    if (document.kind === "text") file.buffer.observeDisk(document);
  };

  const close = (): void => {
    released = true;

    for (const path of held.keys()) stop(path);
    listed.clear();
    void watching?.return?.();
    watching = undefined;
    agents.dispose();
  };

  const store: DesignStore = {
    useDesigns() {
      const made = useChatChanges(workspace.id, (edits) =>
        edits?.filter((edit) => designFile(relative(edit.path))),
      );

      // oxlint-disable-next-line nyte-code/no-direct-effect -- lights what the workspace's chats just changed in its designs
      useEffect(() => {
        agents.notice(made);

        for (const edit of made ?? [])
          if (edit.patches.some((patch) => patch.at >= since)) list(onDisk(relative(edit.path)));
      }, [made]);

      return useSyncExternalStore(subscribe, () => designs);
    },
    useTroubles() {
      return useSyncExternalStore(subscribe, () => troubles);
    },
    read(design) {
      return held.get(onDisk(design))?.buffer.text();
    },
    edit(design, start, end, text) {
      const file = held.get(onDisk(design));

      if (file === undefined) return;
      const before = file.buffer.text();

      file.buffer.edit(`${before.slice(0, start)}${text}${before.slice(end)}`);

      if (file.scheduled !== undefined) return;

      file.scheduled = scheduleSave(
        file.buffer,
        () => {
          file.scheduled?.();
          file.scheduled = undefined;

          return save(file);
        },
        SAVE_MS,
      );
    },
    async overwrite(design) {
      const path = onDisk(design);
      const file = held.get(path);

      if (file === undefined) return;
      const document = await (await connected()).documents.read(path, { as: "document" });

      if (document.kind !== "text" || held.get(path) !== file) return;
      file.buffer.receive({
        kind: "saved",
        contents: document.contents,
        version: document.version,
      });
      await save(file);
    },
    async reload(design) {
      const path = onDisk(design);
      const file = held.get(path);

      if (file === undefined) return;

      if (file.buffer.getSnapshot().status.kind === "saving")
        throw new Error("Wait for the current save to finish.");
      const document = await (await connected()).documents.read(path, { as: "document" });

      if (document.kind !== "text") throw new Error("The file can no longer be read as text.");
      file.buffer.discard(document);
    },
    async save(design) {
      const file = held.get(onDisk(design));

      if (file !== undefined) await save(file);
    },
    shine(subject) {
      shine(subject === null ? null : { ...subject, path: onDisk(subject.path) }, SURFACE);
    },
    lights(lights) {
      const here = lights.agents.filter((light) => light.subject.path.startsWith(`${root}/`));
      const you = lights.you;

      return {
        you:
          you !== null && you.subject.path.startsWith(`${root}/`)
            ? { ...you, subject: { ...you.subject, path: fromRoot(you.subject.path) } }
            : null,
        agents: here.map((light) => ({
          ...light,
          subject: { ...light.subject, path: fromRoot(light.subject.path) },
        })),
      };
    },
    release() {
      releaseStore(workspace.id, store);
    },
  };

  void follow();

  return { store, designs: () => designs, close };
}

export function useDesignStore(workspace: SelectedWorkspace | undefined): DesignStore | undefined {
  const id = workspace?.id;
  const path = workspace?.path;
  const opened = useEffectEvent(() =>
    workspace === undefined ? undefined : openDesignStore(workspace),
  );

  // oxlint-disable-next-line nyte-code/no-direct-effect -- holds the workspace's design store, and its watch of the design folder, while the component is mounted
  useEffect(() => {
    const store = opened();

    return () => store?.release();
  }, [id, path]);

  return useSyncExternalStore(watchStores, () =>
    id === undefined ? undefined : stores.get(id)?.store,
  );
}

export function useNoDesigns(workspace: SelectedWorkspace | undefined): boolean {
  const id = workspace?.id;

  return useSyncExternalStore(
    watchStores,
    () => (id === undefined ? 0 : (stores.get(id)?.designs().paths.length ?? 0)) === 0,
  );
}
