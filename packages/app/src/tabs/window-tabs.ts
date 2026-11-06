import type { ProjectId } from "@nyte-ai/schema";
import type { SessionId } from "@nyte-ai/sdk";
import { reduceLayout } from "../panes/layout.ts";
import type { Layout } from "../panes/layout.ts";
import { createFocusRequests } from "../panes/layout-store.ts";
import type { LayoutStore } from "../panes/layout-store.ts";
import { PaneController } from "../panes/pane-controller.ts";
import { paneRules } from "../panes/pane-kinds.ts";
import type { PaneContent } from "../panes/pane-kinds.ts";
import { chatPanes } from "../panes/pane-layout.ts";
import { SessionViewStateStore } from "../panes/session-view-state.ts";
import { WindowDrafts } from "../chat/composer/drafts.ts";
import { Type } from "typebox";
import {
  activeTab,
  findChatTab,
  initialWindow,
  reduce,
  tabLayout,
  withoutPreviews,
} from "./model.ts";
import type { OpenIntent, WindowAction, WindowState } from "./model.ts";
import { parseStrip, storeStrip } from "./stored-strip.ts";
import type { DesktopWindow } from "../contract/desktop-window.ts";
import { localArea, readStored, removeStored, writeStored } from "../lib/storage.ts";

const WINDOW_KEY_PREFIX = "nyte.window.v1:";

const EARLIER_STRIP_KEY = "nyte.desktop.tabs.v1";

const EARLIER_TAB_KEY_PREFIX = "nyte.desktop.tab.v1:";

const SAVE_DELAY_MS = 250;

const newId = (): string => crypto.randomUUID();

function forgetWindows(windowIds: readonly string[]): void {
  const local = localArea();

  if (local === undefined) return;
  const owned = windowIds.map((id) => `${WINDOW_KEY_PREFIX}${id}:`);

  const stale = Array.from({ length: local.length }, (_, index) => local.key(index)).filter(
    (key): key is string =>
      key !== null &&
      (key === EARLIER_STRIP_KEY ||
        key.startsWith(EARLIER_TAB_KEY_PREFIX) ||
        (key.startsWith(WINDOW_KEY_PREFIX) && !owned.some((prefix) => key.startsWith(prefix)))),
  );

  for (const key of stale) removeStored(local, key);
}

class WindowTabs {
  #strip = false;
  #windowKey = `${WINDOW_KEY_PREFIX}web`;
  #state: WindowState = initialWindow("tab", newId);
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

  start(desktopWindow: DesktopWindow): void {
    this.#strip = true;
    this.#windowKey = `${WINDOW_KEY_PREFIX}${desktopWindow.id}`;

    if (desktopWindow.launch !== undefined) forgetWindows(desktopWindow.launch.windowIds);

    const saved = parseStrip(
      readStored(localArea(), `${this.#windowKey}:tabs`, Type.Unknown(), undefined),
      newId,
    );

    this.#state = saved ?? initialWindow(newId(), newId);
    this.#startupDestination = desktopWindow.launch !== undefined && saved === undefined;
    window.addEventListener("pagehide", this.#flush);
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);

    return () => this.#listeners.delete(listener);
  };

  readonly getSnapshot = (): WindowState => this.#state;

  dispatch(action: WindowAction): void {
    const next =
      action.kind === "open" && !this.#strip ? { ...action, target: "here" as const } : action;

    this.#apply(reduce(this.#state, next, newId));
  }

  openChat(sessionId: SessionId, intent: OpenIntent): void {
    this.dispatch({ kind: "open", place: { kind: "session", sessionId }, target: intent });
  }

  newChat(project?: ProjectId): void {
    this.dispatch(this.#strip ? { kind: "new-tab" } : { kind: "leave-page" });
    this.controller().newChat(project);
  }

  showDraft(draftId: string): void {
    const located = this.#windowDrafts().find(draftId);

    const owner =
      located?.kind === "active"
        ? this.#state.tabs.find(
            (tab) =>
              tab.id === located.tabId &&
              chatPanes(tabLayout(tab)).some(
                (pane) => pane.pane === located.paneId && pane.selection.kind === "blank",
              ),
          )
        : undefined;

    if (owner !== undefined) this.dispatch({ kind: "activate-tab", tabId: owner.id });
    else if (this.#strip) this.dispatch({ kind: "new-tab" });
    else this.dispatch({ kind: "leave-page" });
    this.controller().selectDraft(draftId);
  }

  readonly paneTabId = (): string => findChatTab(this.#state)?.id ?? this.#state.activeTabId;

  controller(tabId: string = this.paneTabId()): PaneController {
    const existing = this.#controllers.get(tabId);

    if (existing !== undefined) return existing;

    const tab =
      this.#state.tabs.find((candidate) => candidate.id === tabId) ?? activeTab(this.#state);

    const controller = new PaneController({
      store: this.#layoutStore(tab.id),
      viewState: new SessionViewStateStore(this.#windowDrafts(), tab.id),
    });

    this.#controllers.set(tab.id, controller);

    return controller;
  }

  #layoutStore(tabId: string): LayoutStore {
    const focus = createFocusRequests();
    const rules = { ...paneRules, newId };

    const read = (): Layout<PaneContent> =>
      tabLayout(
        this.#state.tabs.find((candidate) => candidate.id === tabId) ?? activeTab(this.#state),
      );

    return {
      subscribe: this.subscribe,
      getSnapshot: read,
      dispatch: (...actions) => {
        const current = read();
        const layout = actions.reduce((next, action) => reduceLayout(next, action, rules), current);

        if (layout === current) return;
        this.#apply(reduce(this.#state, { kind: "layout", tabId, layout }, newId), tabId);
      },
      onFocusRequest: focus.onFocusRequest,
      requestFocus: focus.requestFocus,
    };
  }

  #windowDrafts(): WindowDrafts {
    const local = localArea();

    this.#drafts ??= new WindowDrafts(
      local === undefined ? undefined : { storage: local, storageKey: `${this.#windowKey}:drafts` },
    );

    return this.#drafts;
  }

  #apply(next: WindowState, writer?: string): void {
    if (next === this.#state) return;
    const previous = this.#state;
    this.#state = next;

    const known = new Set(
      [...next.tabs, ...next.closed.map((closed) => closed.tab)].map((tab) => tab.id),
    );

    for (const tabId of this.#controllers.keys())
      if (!known.has(tabId)) this.#controllers.delete(tabId);

    const changed = [...this.#controllers].flatMap(([tabId, controller]) => {
      const before = previous.tabs.find((tab) => tab.id === tabId);
      const after = next.tabs.find((tab) => tab.id === tabId);

      return tabId === writer ||
        before === undefined ||
        after === undefined ||
        tabLayout(before) === tabLayout(after)
        ? []
        : [{ store: controller.store, pane: tabLayout(after).focus[0] }];
    });

    this.#save();

    for (const listener of this.#listeners) listener();

    for (const entry of changed) entry.store.requestFocus(entry.pane);
  }

  #save(): void {
    if (!this.#strip) return;
    this.#saveTimer ??= setTimeout(this.#flush, SAVE_DELAY_MS);
  }

  readonly #flush = (): void => {
    clearTimeout(this.#saveTimer);
    this.#saveTimer = undefined;
    const lasting = withoutPreviews(this.#state, () => crypto.randomUUID());

    writeStored(localArea(), `${this.#windowKey}:tabs`, storeStrip(lasting));
  };
}

export const windowTabs = new WindowTabs();
