import { chatKind } from "../chat/chat-pane-kind.ts";
import type { LayoutRules } from "./layout.ts";
import type { StoredContent } from "./layout-persistence.ts";
import type { PaneKind } from "./pane-kind.ts";

/** The app's one list of pane tab kinds. */
const PANE_KINDS = { chat: chatKind };

type Kinds = typeof PANE_KINDS;

export type PaneFieldsMap = {
  [K in keyof Kinds]: Kinds[K] extends PaneKind<infer Fields> ? Fields : never;
};

export type PaneKindName = keyof PaneFieldsMap;

export type PaneContent<K extends PaneKindName = PaneKindName> = {
  [P in K]: { readonly kind: P; readonly fields: PaneFieldsMap[P] };
}[K];

const registry: { readonly [K in PaneKindName]: PaneKind<PaneFieldsMap[K]> } = PANE_KINDS;

export const paneRules: LayoutRules<PaneContent> = {
  identify: (content) => {
    const identity = identifyContent(content);

    return identity === undefined ? undefined : `${content.kind}:${identity}`;
  },
  replaceable: replaceableContent,
  newId: () => crypto.randomUUID(),
};

export function paneMount(content: PaneContent): PaneKind<unknown>["mount"] {
  return registry[content.kind].mount;
}

export function persistPaneContent<K extends PaneKindName>(
  content: PaneContent<K>,
): StoredContent | undefined {
  const fields = registry[content.kind].persist(content.fields);

  return fields === undefined ? undefined : { kind: content.kind, fields };
}

/** An unknown kind or fields its kind rejects drop the tab, not the layout. */
export function restorePaneContent(stored: StoredContent): PaneContent | undefined {
  const kind = Object.keys(registry).find(
    (name): name is PaneKindName => Object.hasOwn(registry, name) && name === stored.kind,
  );

  return kind === undefined ? undefined : restoreKnown(kind, stored.fields);
}

function identifyContent<K extends PaneKindName>(content: PaneContent<K>): string | undefined {
  return registry[content.kind].identity(content.fields);
}

function replaceableContent<K extends PaneKindName>(content: PaneContent<K>): boolean {
  return registry[content.kind].replaceable(content.fields);
}

function restoreKnown<K extends PaneKindName>(
  kind: K,
  fields: unknown,
): PaneContent<K> | undefined {
  const restored = registry[kind].restore(fields);

  return restored === undefined ? undefined : { kind, fields: restored };
}
