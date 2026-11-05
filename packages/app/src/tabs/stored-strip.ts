import { asId } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";
import { sessionId } from "../data/schemas.ts";
import { createLayout } from "../panes/layout.ts";
import type { Layout, Pane, PaneId } from "../panes/layout.ts";
import { persistLayout, restoreLayout, storedLayoutSchema } from "../panes/layout-persistence.ts";
import { persistPaneContent, restorePaneContent } from "../panes/pane-kinds.ts";
import type { PaneContent } from "../panes/pane-kinds.ts";
import { chatContent, paneSelectionSchema } from "../panes/pane-layout.ts";
import type { PaneSelection } from "../panes/pane-layout.ts";
import type { LastingTab, WindowState } from "./model.ts";

const strict = { additionalProperties: false };

const pageSchema = Type.Object(
  {
    kind: Type.Literal("page"),
    page: Type.Object(
      {
        kind: Type.Literal("customize"),
        section: Type.Optional(Type.String()),
        sessionId: Type.Optional(sessionId),
      },
      strict,
    ),
  },
  strict,
);

/** Version 2 held at most two panes, `primary` and `secondary`. */
const earlierPaneId = Type.Union([Type.Literal("primary"), Type.Literal("secondary")]);

const earlierLayoutSchema = Type.Union([
  Type.Object(
    { kind: Type.Literal("single"), paneId: earlierPaneId, selection: paneSelectionSchema },
    strict,
  ),
  Type.Object(
    {
      kind: Type.Literal("split"),
      direction: Type.Union([Type.Literal("right"), Type.Literal("down")]),
      ratio: Type.Number({ minimum: 0.2, maximum: 0.8 }),
      leading: earlierPaneId,
      primary: paneSelectionSchema,
      secondary: paneSelectionSchema,
      activePaneId: earlierPaneId,
    },
    strict,
  ),
]);

function stripSchema<Version extends number, Layout extends TSchema>(
  version: Version,
  layout: Layout,
) {
  const tab = Type.Object(
    {
      id: Type.String({ minLength: 1 }),
      view: Type.Union([pageSchema, Type.Object({ kind: Type.Literal("panes"), layout }, strict)]),
    },
    strict,
  );

  return Type.Object(
    {
      version: Type.Literal(version),
      tabs: Type.Array(tab, { minItems: 1 }),
      activeTabId: Type.String(),
      recent: Type.Array(Type.String()),
      closed: Type.Array(Type.Object({ tab, index: Type.Integer({ minimum: 0 }) }, strict)),
    },
    strict,
  );
}

const earlierStripSchema = stripSchema(2, earlierLayoutSchema);

const currentStripSchema = stripSchema(3, storedLayoutSchema);

type StoredStrip = Static<typeof currentStripSchema>;

/** The lasting tabs of a window as stored; previews are left out before this runs. */
export function storeStrip(state: WindowState): StoredStrip {
  const storeTab = (tab: WindowState["tabs"][number]) => ({
    id: tab.id,
    view:
      tab.view.kind === "page"
        ? { kind: "page" as const, page: tab.view.page }
        : { kind: "panes" as const, layout: persistLayout(tab.view.layout, persistPaneContent) },
  });

  return {
    version: 3,
    tabs: state.tabs.map(storeTab),
    activeTabId: state.activeTabId,
    recent: [...state.recent],
    closed: state.closed.map((closed) => ({ tab: storeTab(closed.tab), index: closed.index })),
  };
}

/**
 * Reads a stored strip, either version. A tab whose layout no longer restores shows a new chat;
 * `createId` names that chat's pane and tab.
 */
export function parseStrip(stored: unknown, createId: () => string): WindowState | undefined {
  if (Value.Check(currentStripSchema, stored))
    return restoreStrip(
      stored,
      (layout) =>
        restoreLayout(layout, restorePaneContent) ??
        createLayout(chatContent({ kind: "blank" }), { newId: createId }),
    );

  return Value.Check(earlierStripSchema, stored) ? restoreStrip(stored, migrateLayout) : undefined;
}

function restoreStrip<Stored>(
  stored: {
    readonly tabs: readonly StoredTab<Stored>[];
    readonly activeTabId: string;
    readonly recent: readonly string[];
    readonly closed: readonly { readonly tab: StoredTab<Stored>; readonly index: number }[];
  },
  restore: (layout: Stored) => Layout<PaneContent>,
): WindowState | undefined {
  const restoreTab = (tab: StoredTab<Stored>): LastingTab => ({
    id: tab.id,
    view: restoreView(tab.view, restore),
  });

  const tabs = stored.tabs.map(restoreTab);
  const open = new Set(tabs.map((tab) => tab.id));
  const activeTabId = open.has(stored.activeTabId) ? stored.activeTabId : tabs[0]?.id;

  if (activeTabId === undefined) return undefined;

  return {
    tabs,
    activeTabId,
    recent: stored.recent.filter((id) => id !== activeTabId && open.has(id)),
    closed: stored.closed.map((closed) => ({ tab: restoreTab(closed.tab), index: closed.index })),
  };
}

interface StoredTab<Stored> {
  readonly id: string;
  readonly view: Static<typeof pageSchema> | { readonly kind: "panes"; readonly layout: Stored };
}

function restoreView<Stored>(
  view: StoredTab<Stored>["view"],
  restore: (layout: Stored) => Layout<PaneContent>,
): LastingTab["view"] {
  if (view.kind === "panes") return { kind: "panes", layout: restore(view.layout) };

  return {
    kind: "page",
    page: { kind: view.page.kind, section: view.page.section, sessionId: view.page.sessionId },
  };
}

/**
 * A version 2 pane keeps its id, so its drafts and scroll still match; a split showing one chat in
 * both panes becomes the focused pane, as version 2 showed it.
 */
function migrateLayout(layout: Static<typeof earlierLayoutSchema>): Layout<PaneContent> {
  if (layout.kind === "single") return singlePane(layout.paneId, layout.selection);

  const focused = layout.activePaneId;
  const other = focused === "primary" ? "secondary" : "primary";
  const focusedSelection = layout[focused];
  const otherSelection = layout[other];

  if (
    focusedSelection.kind === "session" &&
    otherSelection.kind === "session" &&
    focusedSelection.sessionId === otherSelection.sessionId
  )
    return singlePane(focused, focusedSelection);

  const trailing = layout.leading === "primary" ? "secondary" : "primary";

  return {
    root: {
      kind: "split",
      id: asId<"split">("split"),
      direction: layout.direction,
      children: [
        {
          node: earlierPane(layout.leading, layout[layout.leading]),
          size: { kind: "share", share: layout.ratio },
        },
        {
          node: earlierPane(trailing, layout[trailing]),
          size: { kind: "share", share: 1 - layout.ratio },
        },
      ],
    },
    focus: [asId<"pane">(focused), asId<"pane">(other)],
    zoomed: null,
  };
}

function singlePane(id: string, selection: PaneSelection): Layout<PaneContent> {
  return { root: earlierPane(id, selection), focus: [asId<"pane">(id)], zoomed: null };
}

function earlierPane(id: string, selection: PaneSelection): Pane<PaneContent> {
  const pane: PaneId = asId<"pane">(id);
  const tab = { id: asId<"pane-tab">(`${id}-chat`), content: chatContent(selection) };

  return { kind: "pane", id: pane, tabs: [tab], active: tab.id, hidden: false };
}
