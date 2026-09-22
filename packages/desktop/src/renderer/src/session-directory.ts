import type { SessionsBridge } from "../../shared/ipc.ts";

export type SessionPage = Awaited<ReturnType<SessionsBridge["list"]>>;

/** Read every root session before publishing a workspace change; children live under their parent's task call. */
export async function loadSessionDirectory(list: SessionsBridge["list"]): Promise<SessionPage> {
  const first = await list({ parent: null, includeArchived: true });
  const items = [...first.items];
  let cursor = first.next;

  while (cursor !== undefined) {
    const page = await list({ cursor, parent: null, includeArchived: true });
    items.push(...page.items);
    cursor = page.next;
  }

  return { ...first, items, next: undefined };
}
