import type { Kernel } from "../contract/kernel.ts";
import { decodeProjectRecord } from "../contract/records.ts";
import type { SessionRecord } from "../contract/records.ts";
import type { Resources } from "../contract/workspace.ts";
import { projectRef } from "../store/refs.ts";
import { load } from "../store/session.ts";

type ContextFile = Resources["contextFiles"][number];

export type ContextFilter = (file: ContextFile) => boolean;

export const KEEP_ALL: ContextFilter = () => true;

export const KEEP_NONE: ContextFilter = () => false;

export async function contextFilter(kernel: Kernel, record: SessionRecord): Promise<ContextFilter> {
  if (record.contextFiles === false) return KEEP_NONE;

  if (record.project === undefined) return KEEP_ALL;

  const project = await load(
    kernel.store,
    await kernel.store.refs.get(projectRef(record.project)),
    decodeProjectRecord,
  );

  const off = new Set(project?.record.disabledDocs ?? []);

  return off.size === 0 ? KEEP_ALL : (file) => !off.has(file.id);
}

export function contextFile(
  found: Omit<ContextFile, "id"> & { readonly name: string },
): ContextFile {
  const key = found.scope === "ancestor" ? found.path : found.name;

  return {
    id: `context:${found.scope}:${key}`,
    path: found.path,
    scope: found.scope,
    content: found.content,
  };
}
