import { useEffect, useSyncExternalStore } from "react";
import type { FileVersion } from "@nyte-ai/sdk";
import type { SelectedWorkspace } from "../contract/bridge.ts";
import { connected } from "../data/connection.ts";
import { useMentionFiles } from "../data/files.ts";
import { carryLight, shine, shineAgent } from "../light/light.ts";
import type { Lights, Subject } from "../light/light.ts";

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

interface Held {
  text: string;
  version: FileVersion | null;
  dirty: boolean;
  save: ReturnType<typeof setTimeout> | undefined;
}

const SAVE_MS = 150;

/** The name the board moves the light under, so it draws its own moves without flying the camera to them. */
export const SURFACE = "design";

const EMPTY: Designs = { paths: [], texts: new Map() };

const held = new Map<string, Held>();

const listeners = new Set<() => void>();

let root = "";

let tracked: readonly string[] = [];

let watching: AsyncIterator<unknown> | undefined;

let designs = EMPTY;

function publish(): void {
  designs = {
    paths: tracked.map(fromRoot),
    texts: new Map(
      tracked.flatMap((path) => {
        const file = held.get(path);

        return file === undefined ? [] : [[fromRoot(path), file.text] as const];
      }),
    ),
  };

  for (const listener of listeners) listener();
}

const fromRoot = (path: string): string => path.slice(root.length + 1);

const onDisk = (path: string): string => `${root}/${path}`;

interface Range {
  readonly start: number;
  readonly end: number;
}

function changedRange(before: string, next: string): Range {
  let start = 0;

  while (start < before.length && start < next.length && before[start] === next[start]) start += 1;
  let tail = 0;

  while (
    tail < before.length - start &&
    tail < next.length - start &&
    before[before.length - 1 - tail] === next[next.length - 1 - tail]
  )
    tail += 1;

  return { start, end: Math.max(start + 1, next.length - tail) };
}

async function load(path: string, lit: boolean): Promise<void> {
  const document = await (await connected()).documents.read(path, { as: "document" });
  const file = held.get(path);

  if (document.kind !== "text" || !tracked.includes(path) || file?.dirty === true) return;

  if (file !== undefined && file.version === document.version) return;

  if (file !== undefined && lit && file.text !== document.contents)
    shineAgent({ kind: "span", path, ...changedRange(file.text, document.contents) });
  held.set(path, {
    text: document.contents,
    version: document.version,
    dirty: false,
    save: undefined,
  });
  publish();
}

async function watch(paths: readonly string[]): Promise<void> {
  const events = (await connected()).documents.watch(paths)[Symbol.asyncIterator]();

  await watching?.return?.();
  watching = events;

  for (let next = await events.next(); next.done !== true; next = await events.next())
    for (const event of next.value)
      if (held.get(event.path)?.version !== event.version) void load(event.path, true);
}

function track(folder: string, paths: readonly string[]): void {
  if (
    folder === root &&
    paths.length === tracked.length &&
    paths.every((path, index) => path === tracked[index])
  )
    return;
  root = folder;
  tracked = paths;

  for (const path of held.keys()) if (!paths.includes(path)) held.delete(path);

  for (const path of paths) if (!held.has(path)) void load(path, false);
  void watch(paths);
  publish();
}

async function save(path: string): Promise<void> {
  const file = held.get(path);

  if (file === undefined || !file.dirty) return;
  const sent = file.text;

  const outcome = await (
    await connected()
  ).documents.write(path, sent, {
    expect: file.version ?? "absent",
  });

  if (outcome.kind === "saved") {
    file.version = outcome.version;
    file.dirty = file.text !== sent;

    if (file.dirty) file.save = setTimeout(() => void save(path), SAVE_MS);

    return;
  }

  file.dirty = false;
  await load(path, false);
}

/** Replaces a range of a design's text, here at once and on disk a moment later; the person's light moves with the text. */
export function edit(design: string, start: number, end: number, text: string): void {
  const path = onDisk(design);
  const file = held.get(path);

  if (file === undefined) return;
  file.text = `${file.text.slice(0, start)}${text}${file.text.slice(end)}`;
  file.dirty = true;
  clearTimeout(file.save);
  file.save = setTimeout(() => void save(path), SAVE_MS);
  carryLight(path, start, end, text.length);
  publish();
}

/** The text of a design as this window has it now, unsaved edits included. */
export function readDesign(design: string): string | undefined {
  return held.get(onDisk(design))?.text;
}

/** Moves the person's light to a design, or a range of one, from the board; `null` puts it out. */
export function shineDesign(subject: Subject | null): void {
  shine(subject === null ? null : { ...subject, path: onDisk(subject.path) }, SURFACE);
}

/** The lights that are on this workspace's designs, named as the designs are. */
export function designLights(lights: Lights): Lights {
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
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

/** Whether the Design tab found no design files, so it shows only its empty state. */
export function useNoDesigns(): boolean {
  return useSyncExternalStore(subscribe, () => designs.paths.length === 0);
}

/** The workspace's design files and their text. One store serves the window, so the list and the board agree. */
export function useDesigns(workspace: SelectedWorkspace | undefined): Designs {
  const files = useMentionFiles(workspace, workspace !== undefined);

  const folder = workspace?.path.replace(/\/$/u, "") ?? "";

  const listed = (files.data ?? [])
    .filter(
      (file) =>
        file.kind === "file" &&
        file.path.startsWith(`${folder}/design/`) &&
        (file.path.endsWith(".jsx") || file.path.endsWith(".css")),
    )
    .map((file) => file.path)
    .toSorted()
    .join("\n");

  // oxlint-disable-next-line nyte-code/no-direct-effect -- points the module's file watch at the workspace's design files
  useEffect(() => track(folder, listed === "" ? [] : listed.split("\n")), [folder, listed]);

  return useSyncExternalStore(subscribe, () => designs);
}
