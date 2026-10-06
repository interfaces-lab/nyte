/**
 * The desktop window's tabs. One store per renderer: it owns the strip, gives
 * each tab its own pane controller, keeps the strip in sessionStorage for a
 * reload, and mirrors the focused window's strip to localStorage, which the
 * first window of the next launch adopts. The web app never starts it.
 */
import type { Static } from "typebox";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { routeShellPages } from "../chrome/shell-state.ts";
import { PaneController } from "../layout/pane-controller.ts";
import { paneLayoutSchema, paneSelectionSchema } from "../layout/pane-layout.ts";
import type { PaneLayout, PaneLayoutAction } from "../layout/pane-layout.ts";
import { sessionId } from "../schemas.ts";
import { activeTab, canTravel, initialWindow, reduce, tabLayout } from "./model.ts";
import type { Tab, View, WindowAction, WindowState } from "./model.ts";

const STRIP_KEY = "nyte.desktop.tabs.v1";

/** Each tab's drafts and images live under this prefix and its id. */
const TAB_KEY_PREFIX = "nyte.desktop.tab.v1:";

/** Every window holds this shared lock, so a starting window knows whether it is the first. */
const WINDOW_LOCK = "nyte.desktop.window";

const strict = { additionalProperties: false };

const historySchema = Type.Object(
  { back: Type.Array(paneSelectionSchema), forward: Type.Array(paneSelectionSchema) },
  strict,
);

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
  Type.Object(
    {
      kind: Type.Literal("panes"),
      layout: paneLayoutSchema,
      history: Type.Object({ primary: historySchema, secondary: historySchema }, strict),
    },
    strict,
  ),
]);

const tabSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    views: Type.Array(viewSchema, { minItems: 1 }),
    index: Type.Integer({ minimum: 0 }),
  },
  strict,
);

const stripSchema = Type.Object(
  {
    version: Type.Literal(1),
    tabs: Type.Array(tabSchema, { minItems: 1 }),
    activeTabId: Type.String(),
    closed: Type.Array(
      Type.Object({ tab: tabSchema, index: Type.Integer({ minimum: 0 }) }, strict),
    ),
  },
  strict,
);

type StoredTab = Static<typeof tabSchema>;

function storedView(view: StoredTab["views"][number]): View {
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
  return {
    id: tab.id,
    views: tab.views.map(storedView),
    index: Math.min(tab.index, tab.views.length - 1),
  };
}

function parseStrip(raw: string | null): WindowState | undefined {
  if (raw === null) return undefined;

  try {
    const stored: unknown = JSON.parse(raw);

    if (!Value.Check(stripSchema, stored)) return undefined;
    const tabs = stored.tabs.map(storedTab);

    return {
      tabs,
      activeTabId: tabs.some((tab) => tab.id === stored.activeTabId)
        ? stored.activeTabId
        : (tabs[0]?.id ?? stored.activeTabId),
      closed: stored.closed.map(({ tab, index }) => ({ tab: storedTab(tab), index })),
    };
  } catch {
    return undefined;
  }
}

function storage(kind: "localStorage" | "sessionStorage"): Storage | undefined {
  try {
    return window[kind];
  } catch {
    return undefined;
  }
}

function read(store: Storage | undefined, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(store: Storage | undefined, key: string, value: string): void {
  try {
    store?.setItem(key, value);
  } catch {
    // A full or denied store keeps the strip for this window only.
  }
}

/** The ids a strip still refers to: open tabs and the reopen list. */
function knownTabIds(state: WindowState): ReadonlySet<string> {
  return new Set([...state.tabs, ...state.closed.map(({ tab }) => tab)].map((tab) => tab.id));
}

/** Drop the stored drafts of tabs no strip refers to any more. */
function forgetTabs(shouldForget: (tabId: string) => boolean): void {
  const local = storage("localStorage");

  if (local === undefined) return;

  try {
    const stale = Array.from({ length: local.length }, (_, index) => local.key(index)).filter(
      (key): key is string =>
        key !== null &&
        key.startsWith(TAB_KEY_PREFIX) &&
        shouldForget(key.slice(TAB_KEY_PREFIX.length).split(":")[0] ?? ""),
    );

    for (const key of stale) local.removeItem(key);
  } catch {
    // Stale drafts only cost space.
  }
}

/** Whether no other window of this launch is open; it then adopts the saved strip. */
async function firstWindow(): Promise<boolean> {
  if (!("locks" in navigator)) return true;

  try {
    const { held = [] } = await navigator.locks.query();
    void navigator.locks.request(
      WINDOW_LOCK,
      { mode: "shared" },
      () => new Promise(() => undefined),
    );

    return !held.some((lock) => lock.name === WINDOW_LOCK);
  } catch {
    return true;
  }
}

class WindowTabs {
  #enabled = false;
  #state: WindowState = initialWindow("tab");
  /** True only for the first window of a launch with nothing saved: the startup chat applies. */
  #startupDestination = false;
  readonly #controllers = new Map<string, PaneController>();
  readonly #listeners = new Set<() => void>();

  get enabled(): boolean {
    return this.#enabled;
  }

  get startupDestination(): boolean {
    return this.#startupDestination;
  }

  /** Restore a reload synchronously; resolves once a first window has adopted the saved strip. */
  start(): Promise<void> {
    this.#enabled = true;
    const reloaded = parseStrip(read(storage("sessionStorage"), STRIP_KEY));
    this.#state = reloaded ?? initialWindow(crypto.randomUUID());
    window.addEventListener("focus", () => this.#mirror());
    routeShellPages((page) =>
      this.dispatch(
        page === undefined
          ? { kind: "leave-page" }
          : {
              kind: "open",
              target: "here",
              place:
                page.kind === "customize"
                  ? { kind: "customize", section: undefined, sessionId: page.sessionId }
                  : { kind: "environments", section: undefined },
            },
      ),
    );

    return firstWindow().then((first) => {
      if (!first || reloaded !== undefined) return;
      const saved = parseStrip(read(storage("localStorage"), STRIP_KEY));
      const kept = knownTabIds(saved ?? this.#state);
      forgetTabs((tabId) => !kept.has(tabId));

      if (saved === undefined) {
        this.#startupDestination = true;

        return;
      }

      this.#apply(saved);
    });
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);

    return () => this.#listeners.delete(listener);
  };

  readonly getSnapshot = (): WindowState => this.#state;

  dispatch(action: WindowAction): void {
    this.#apply(reduce(this.#state, action, () => crypto.randomUUID()));
  }

  canTravel(step: 1 | -1): boolean {
    return canTravel(this.#state, step);
  }

  /** The pane controller of a tab, the active one by default. */
  controller(tabId: string = this.#state.activeTabId): PaneController {
    const existing = this.#controllers.get(tabId);

    if (existing !== undefined) return existing;

    const tab =
      this.#state.tabs.find((candidate) => candidate.id === tabId) ?? activeTab(this.#state);

    const controller = new PaneController({
      storage: storage("localStorage"),
      storageKey: `${TAB_KEY_PREFIX}${tab.id}`,
      initialLayout: tabLayout(tab),
      route: (current, next, action) => this.#route(tab.id, current, next, action),
    });

    this.#controllers.set(tab.id, controller);

    return controller;
  }

  #route(
    tabId: string,
    current: PaneLayout,
    next: PaneLayout,
    action: PaneLayoutAction,
  ): PaneLayout {
    if (tabId !== this.#state.activeTabId) return current;

    this.#apply(
      reduce(this.#state, { kind: "layout", action, layout: next }, () => crypto.randomUUID()),
      tabId,
    );

    const tab = this.#state.tabs.find((candidate) => candidate.id === tabId);

    return tab === undefined ? current : tabLayout(tab);
  }

  /** `routing` is the controller whose own proposal this is; it adopts the result itself. */
  #apply(next: WindowState, routing?: string): void {
    if (next === this.#state) return;
    const before = knownTabIds(this.#state);
    this.#state = next;
    const known = knownTabIds(next);

    for (const [tabId, controller] of this.#controllers) {
      if (!known.has(tabId)) {
        this.#controllers.delete(tabId);
        continue;
      }

      const tab = next.tabs.find((candidate) => candidate.id === tabId);

      if (tab !== undefined && tabId !== routing) controller.show(tabLayout(tab));
    }

    const gone = new Set([...before].filter((tabId) => !known.has(tabId)));

    if (gone.size > 0) forgetTabs((tabId) => gone.has(tabId));
    this.#save();

    for (const listener of this.#listeners) listener();
  }

  #save(): void {
    write(storage("sessionStorage"), STRIP_KEY, this.#serialized());

    if (document.hasFocus()) this.#mirror();
  }

  #mirror(): void {
    if (this.#enabled) write(storage("localStorage"), STRIP_KEY, this.#serialized());
  }

  #serialized(): string {
    return JSON.stringify({ version: 1, ...this.#state });
  }
}

export const windowTabs = new WindowTabs();
