import type { SessionsBridge } from "../../shared/ipc.ts";

export type SessionPage = Awaited<ReturnType<SessionsBridge["list"]>>;

/** Read the complete local directory before publishing a workspace change. */
export async function loadSessionDirectory(list: SessionsBridge["list"]): Promise<SessionPage> {
  const first = await list({ includeArchived: true });
  const items = [...first.items];
  let cursor = first.next;
  while (cursor !== undefined) {
    const page = await list({ cursor, includeArchived: true });
    items.push(...page.items);
    cursor = page.next;
  }
  return { ...first, items, next: undefined };
}
