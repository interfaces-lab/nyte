import type { SessionId } from "@nyte-ai/sdk";
import { chatPanes } from "../panes/pane-layout.ts";
import { WindowDrafts } from "../drafts/drafts.ts";
import { Type } from "typebox";
import { initialWindow, paneTabId, tabLayout, withoutPreviews } from "./model.ts";
import type { OpenIntent, WindowAction } from "./model.ts";
import { parseStrip, storeStrip } from "./stored-strip.ts";
import { WindowStore } from "./window-store.ts";
import type { TabPanes } from "./window-store.ts";
import type { DesktopWindow } from "../contract/desktop-window.ts";
import type { DraftStart } from "../panes/session-view-state.ts";
import { preferences } from "../preferences/index.ts";
import { windowApp } from "../contract/nyte.ts";
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
  private stored = false;
  private windowKey = `${WINDOW_KEY_PREFIX}web`;
  private wantsStartupDestination = true;
  private drafts: WindowDrafts | undefined;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  readonly store = new WindowStore(initialWindow("tab", newId), () => this.windowDrafts());

  constructor() {
    this.store.subscribe(() => this.save());
  }

  get strip(): boolean {
    return this.stored && windowApp() !== "code";
  }

  get startupDestination(): boolean {
    return this.wantsStartupDestination;
  }

  start(desktopWindow: Pick<DesktopWindow, "id" | "launch">): void {
    this.stored = true;
    this.windowKey = `${WINDOW_KEY_PREFIX}${desktopWindow.id}`;

    if (desktopWindow.launch !== undefined) forgetWindows(desktopWindow.launch.windowIds);

    const saved = parseStrip(
      readStored(localArea(), `${this.windowKey}:tabs`, Type.Unknown(), undefined),
      newId,
    );

    this.store.restore(saved ?? initialWindow(newId(), newId));
    this.wantsStartupDestination = desktopWindow.launch !== undefined && saved === undefined;
    window.addEventListener("pagehide", this.flush);
  }

  readonly subscribe = this.store.subscribe;

  readonly getSnapshot = this.store.getSnapshot;

  dispatch(action: WindowAction): void {
    this.store.dispatch(
      action.kind === "open" && !this.strip ? { ...action, target: "here" } : action,
    );
  }

  openChat(sessionId: SessionId, intent: OpenIntent): void {
    this.dispatch({ kind: "open", place: { kind: "session", sessionId }, target: intent });
  }

  newChat(start: DraftStart = {}): void {
    if (start.folder !== undefined) preferences.draftFolder.set(start.folder);
    this.dispatch(this.strip ? { kind: "new-tab" } : { kind: "leave-page" });
    this.store.newChat(this.paneTabId(), start);
  }

  showDraft(draftId: string): void {
    const located = this.windowDrafts().find(draftId);

    const owner =
      located?.kind === "active"
        ? this.getSnapshot().tabs.find(
            (tab) =>
              tab.id === located.tabId &&
              chatPanes(tabLayout(tab)).some(
                (pane) => pane.pane === located.paneId && pane.selection.kind === "blank",
              ),
          )
        : undefined;

    if (owner !== undefined) this.dispatch({ kind: "activate-tab", tabId: owner.id });
    else if (this.strip) this.dispatch({ kind: "new-tab" });
    else this.dispatch({ kind: "leave-page" });
    this.store.selectDraft(this.paneTabId(), draftId);
  }

  removeDraft(draftId: string): void {
    this.store.removeDraft(this.paneTabId(), draftId);
  }

  readonly paneTabId = (): string => paneTabId(this.getSnapshot());

  panes(): TabPanes {
    return this.store.tab(this.paneTabId());
  }

  private windowDrafts(): WindowDrafts {
    const local = localArea();

    this.drafts ??= new WindowDrafts(
      local === undefined ? undefined : { storage: local, storageKey: `${this.windowKey}:drafts` },
    );

    return this.drafts;
  }

  private save(): void {
    if (!this.stored) return;
    this.saveTimer ??= setTimeout(this.flush, SAVE_DELAY_MS);
  }

  private readonly flush = (): void => {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    const lasting = withoutPreviews(this.getSnapshot(), () => crypto.randomUUID());

    writeStored(localArea(), `${this.windowKey}:tabs`, storeStrip(lasting));
  };
}

export const windowTabs = new WindowTabs();
