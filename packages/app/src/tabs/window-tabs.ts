import type { Static } from "typebox";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { PaneController } from "../layout/pane-controller.ts";
import { paneLayoutSchema, paneSelection } from "../layout/pane-layout.ts";
import type { PaneLayout } from "../layout/pane-layout.ts";
import { SessionViewStateStore, WindowDrafts } from "../layout/session-view-state.ts";
import { sessionId } from "../schemas.ts";
import { activeTab, findChatTab, initialWindow, reduce, tabLayout } from "./model.ts";
import type { Tab, View, WindowAction, WindowState } from "./model.ts";

/** Each window keeps its tabs and drafts under its own id. */
const WINDOW_KEY_PREFIX = "nyte.window.v1:";

/** What earlier builds saved: one tab strip for every window, and drafts under each tab. */
const EARLIER_STRIP_KEY = "nyte.desktop.tabs.v1";

const EARLIER_TAB_KEY_PREFIX = "nyte.desktop.tab.v1:";

const SAVE_DELAY_MS = 250;

/** How the desktop opened a window: its lasting id and, when no other window was open, every id worth keeping. */
export interface DesktopWindow {
  readonly id: string;
  readonly launch: { readonly windowIds: readonly string[] } | undefined;
}

const strict = { additionalProperties: false };

const section = Type.Optional(Type.String());

const viewSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("page"),
      page: Type.Union([
        Type.Object(
          { kind: Type.Literal("customize"), section, sessionId: Type.Optional(sessionId) },
          strict,
        ),
        Type.Object({ kind: Type.Literal("environments"), section }, strict),
      ]),
    },
    strict,
  ),
  Type.Object({ kind: Type.Literal("panes"), layout: paneLayoutSchema }, strict),
]);

const tabSchema = Type.Object({ id: Type.String({ minLength: 1 }), view: viewSchema }, strict);

const stripSchema = Type.Object(
  {
    version: Type.Literal(2),
    tabs: Type.Array(tabSchema, { minItems: 1 }),
    activeTabId: Type.String(),
    recent: Type.Array(Type.String()),
    closed: Type.Array(
      Type.Object({ tab: tabSchema, index: Type.Integer({ minimum: 0 }) }, strict),
    ),
  },
  strict,
);

type StoredTab = Static<typeof tabSchema>;

function storedView(view: StoredTab["view"]): View {
  if (view.kind === "panes") return view;

  return {
    kind: "page",
    page:
      view.page.kind === "customize"
        ? { kind: "customize", section: view.page.section, sessionId: view.page.sessionId }
        : { kind: "environments", section: view.page.section },
  };
}

function storedTab(tab: StoredTab): Tab {
  return { id: tab.id, view: storedView(tab.view) };
}

function parseStrip(raw: string | null): WindowState | undefined {
  if (raw === null) return undefined;

  try {
    const stored: unknown = JSON.parse(raw);

    if (!Value.Check(stripSchema, stored)) return undefined;
    const tabs = stored.tabs.map(storedTab);
    const open = new Set(tabs.map((tab) => tab.id));
    const activeTabId = open.has(stored.activeTabId) ? stored.activeTabId : tabs[0]?.id;

    if (activeTabId === undefined) return undefined;

    return {
      tabs,
      activeTabId,
      recent: stored.recent.filter((id) => id !== activeTabId && open.has(id)),
      closed: stored.closed.map(({ tab, index }) => ({ tab: storedTab(tab), index })),
    };
  } catch {
    return undefined;
  }
}

function localStore(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function read(key: string): string | null {
  try {
    return localStore()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStore()?.setItem(key, value);
  } catch {}
}

/** Removes what no open window owns: closed windows' tabs and drafts, and what earlier builds saved. */
function forgetWindows(windowIds: readonly string[]): void {
  const local = localStore();

  if (local === undefined) return;
  const owned = windowIds.map((id) => `${WINDOW_KEY_PREFIX}${id}:`);

  try {
    const stale = Array.from({ length: local.length }, (_, index) => local.key(index)).filter(
      (key): key is string =>
        key !== null &&
        (key === EARLIER_STRIP_KEY ||
          key.startsWith(EARLIER_TAB_KEY_PREFIX) ||
          (key.startsWith(WINDOW_KEY_PREFIX) && !owned.some((prefix) => key.startsWith(prefix)))),
    );

    for (const key of stale) local.removeItem(key);
  } catch {}
}

class WindowTabs {
  #strip = false;
  #windowKey = `${WINDOW_KEY_PREFIX}web`;
  #state: WindowState = initialWindow("tab");
  #startupDestination = true;
  #drafts: WindowDrafts | undefined;
  readonly #controllers = new Map<string, PaneController>();
  readonly #listeners = new Set<() => void>();
  #saveTimer: ReturnType<typeof setTimeout> | undefined;

  get strip(): boolean {
    return this.#strip;
  }

  get startupDestination(): boolean {
    return this.#startupDestination;
  }

  /** Restores this window's own tabs; the first window of a launch also clears what no window owns. */
  start(desktopWindow: DesktopWindow): void {
    this.#strip = true;
    this.#windowKey = `${WINDOW_KEY_PREFIX}${desktopWindow.id}`;

    if (desktopWindow.launch !== undefined) forgetWindows(desktopWindow.launch.windowIds);
    const saved = parseStrip(read(`${this.#windowKey}:tabs`));
    this.#state = saved ?? initialWindow(crypto.randomUUID());
    this.#startupDestination = desktopWindow.launch !== undefined && saved === undefined;
    window.addEventListener("pagehide", this.#flush);
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);

    return () => this.#listeners.delete(listener);
  };

  readonly getSnapshot = (): WindowState => this.#state;

  /** Without a strip the window has one tab, so every open replaces what it shows. */
  dispatch(action: WindowAction): void {
    const next =
      action.kind === "open" && !this.#strip ? { ...action, target: "here" as const } : action;

    this.#apply(reduce(this.#state, next, () => crypto.randomUUID()));
  }

  /** A new chat gets its own tab, or the new-chat tab already waiting; one tab replaces its view. */
  newChat(): void {
    this.dispatch(this.#strip ? { kind: "new-tab" } : { kind: "leave-page" });
    this.controller().newChat();
  }

  /** Shows a draft in the tab whose new chat it is, else in the window's new-chat tab. */
  showDraft(draftId: string): void {
    const located = this.#windowDrafts().find(draftId);

    const owner =
      located?.kind === "active"
        ? this.#state.tabs.find(
            (tab) =>
              tab.id === located.tabId &&
              paneSelection(tabLayout(tab), located.paneId)?.kind === "blank",
          )
        : undefined;

    if (owner !== undefined) this.dispatch({ kind: "activate-tab", tabId: owner.id });
    else if (this.#strip) this.dispatch({ kind: "new-tab" });
    else this.dispatch({ kind: "leave-page" });
    this.controller().selectDraft(draftId);
  }

  /** The tab whose panes the window shows: the active tab, or under a page the chat tab used last. */
  readonly paneTabId = (): string => findChatTab(this.#state)?.id ?? this.#state.activeTabId;

  controller(tabId: string = this.paneTabId()): PaneController {
    const existing = this.#controllers.get(tabId);

    if (existing !== undefined) return existing;

    const tab =
      this.#state.tabs.find((candidate) => candidate.id === tabId) ?? activeTab(this.#state);

    const controller = new PaneController({
      initialLayout: tabLayout(tab),
      route: (current, next) => this.#route(tab.id, current, next),
      viewState: new SessionViewStateStore(this.#windowDrafts(), tab.id),
    });

    this.#controllers.set(tab.id, controller);

    return controller;
  }

  #windowDrafts(): WindowDrafts {
    const local = localStore();

    this.#drafts ??= new WindowDrafts(
      local === undefined ? undefined : { storage: local, storageKey: `${this.#windowKey}:drafts` },
    );

    return this.#drafts;
  }

  #route(tabId: string, current: PaneLayout, next: PaneLayout): PaneLayout {
    this.#apply(
      reduce(this.#state, { kind: "layout", tabId, layout: next }, () => crypto.randomUUID()),
      tabId,
    );

    const tab = this.#state.tabs.find((candidate) => candidate.id === tabId);

    return tab === undefined ? current : tabLayout(tab);
  }

  #apply(next: WindowState, routing?: string): void {
    if (next === this.#state) return;
    this.#state = next;

    const known = new Set(
      [...next.tabs, ...next.closed.map((closed) => closed.tab)].map((tab) => tab.id),
    );

    for (const [tabId, controller] of this.#controllers) {
      if (!known.has(tabId)) {
        this.#controllers.delete(tabId);
        continue;
      }

      const tab = next.tabs.find((candidate) => candidate.id === tabId);

      if (tab !== undefined && tabId !== routing) controller.show(tabLayout(tab));
    }

    this.#save();

    for (const listener of this.#listeners) listener();
  }

  #save(): void {
    if (!this.#strip) return;
    this.#saveTimer ??= setTimeout(this.#flush, SAVE_DELAY_MS);
  }

  readonly #flush = (): void => {
    clearTimeout(this.#saveTimer);
    this.#saveTimer = undefined;
    write(`${this.#windowKey}:tabs`, JSON.stringify({ version: 2, ...this.#state }));
  };
}

export const windowTabs = new WindowTabs();
