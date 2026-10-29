import { useSyncExternalStore } from "react";
import type { PartId, SessionId } from "@nyte-ai/sdk";
import { clientCapabilities } from "../contract/client-actions.ts";
import type { ClientCapabilities } from "../contract/client-actions.ts";
import { loadDeferred, readDeferred } from "../lib/deferred.tsx";
import { nyte } from "../contract/nyte.ts";
import {
  DEFAULT_VIEW,
  MAXIMIZED_CHAT_LAYOUT,
  MAXIMIZED_WORKBENCH_LAYOUT,
  SPLIT_LAYOUT,
  type WorkbenchSnapshot,
  type WorkbenchTab,
  type WorkbenchTabId,
  type WorkbenchTabInput,
  type WorkbenchTabUpdate,
  type WorkbenchViewKey,
  type WorkbenchViewState,
  revealWorkbench,
  sameChangesScope,
  shownWorkbenchTab,
  workbenchScope,
  workbenchShowsChat,
  workbenchViewKey,
} from "./model.ts";
import {
  type WorkbenchPersistence,
  persistable,
  restoreSnapshot,
  workbenchPersistence,
} from "./persistence.ts";
import { shareWidth } from "./width.ts";

export interface WorkbenchPanels {
  readonly ready: () => boolean;
  readonly load: () => Promise<void>;
}

export interface WorkbenchController {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => WorkbenchSnapshot;
  readonly getView: (key: WorkbenchViewKey) => WorkbenchViewState;
  readonly actions: {
    readonly openTab: (input: {
      readonly view: WorkbenchViewKey;
      readonly tab: WorkbenchTabInput;
      readonly activate: boolean;
    }) => WorkbenchTabId;
    readonly activateTab: (input: {
      readonly view: WorkbenchViewKey;
      readonly id: WorkbenchTabId;
    }) => void;
    readonly closeTab: (input: {
      readonly view: WorkbenchViewKey;
      readonly id: WorkbenchTabId;
    }) => void;
    readonly moveTab: (input: {
      readonly view: WorkbenchViewKey;
      readonly id: WorkbenchTabId;
      readonly index: number;
    }) => void;
    readonly updateTab: (input: WorkbenchTabUpdate) => void;
    readonly scrollTab: (input: {
      readonly view: WorkbenchViewKey;
      readonly id: WorkbenchTabId;
      readonly scrollTop: number;
    }) => void;
    readonly toggle: (input: { readonly view: WorkbenchViewKey }) => void;
    readonly toggleCollapsed: (input: { readonly view: WorkbenchViewKey }) => void;
    readonly toggleWorkbench: (input: { readonly view: WorkbenchViewKey }) => void;
    readonly toggleMaximized: (input: { readonly view: WorkbenchViewKey }) => void;
    readonly showChat: (input: { readonly view: WorkbenchViewKey }) => void;
    readonly setShare: (input: { readonly view: WorkbenchViewKey; readonly share: number }) => void;
  };
}

function freezeView(view: WorkbenchViewState): WorkbenchViewState {
  return Object.freeze({
    ...view,
    tabs: Object.freeze(view.tabs.map((tab) => Object.freeze(tab))),
  });
}

function sameTab(tab: WorkbenchTab, input: WorkbenchTabInput): boolean {
  if (tab.kind !== input.kind) return false;

  switch (tab.kind) {
    case "file":
      return input.kind === "file" && tab.path === input.path;
    case "terminal":
      return (
        input.kind === "terminal" &&
        tab.owner.kind === "agent" &&
        input.owner.kind === "agent" &&
        tab.owner.sessionId === input.owner.sessionId &&
        tab.owner.jobId === input.owner.jobId
      );
    case "browser":
      return input.kind === "browser" && tab.url === input.url;
    case "canvas":
      return (
        input.kind === "canvas" && tab.sessionId === input.sessionId && tab.part === input.part
      );
    case "changes":
    case "files":
      return true;
    default: {
      const _exhaustive: never = tab;

      return _exhaustive;
    }
  }
}

function patchTab(tab: WorkbenchTab, input: WorkbenchTabUpdate): WorkbenchTab {
  switch (input.kind) {
    case "changes":
      if (
        tab.kind !== "changes" ||
        (sameChangesScope(tab.scope, input.patch.scope) &&
          tab.selectedPath === input.patch.selectedPath &&
          tab.pathRevealRevision === input.patch.pathRevealRevision &&
          tab.scrollTop === input.patch.scrollTop)
      )
        return tab;

      return { id: tab.id, kind: "changes", ...input.patch };
    case "file":
      return tab.kind !== "file" || tab.preview === input.patch.preview
        ? tab
        : { ...tab, preview: input.patch.preview };
    case "browser":
      return tab.kind !== "browser" || tab.url === input.patch.url
        ? tab
        : { id: tab.id, kind: "browser", ...input.patch };
    case "canvas": {
      if (tab.kind !== "canvas") return tab;
      const next = { ...tab, ...input.patch };

      return next.title === tab.title && next.pinned === tab.pinned ? tab : next;
    }

    default: {
      const _exhaustive: never = input;

      return _exhaustive;
    }
  }
}

export function createWorkbenchController(
  capabilities: () => ClientCapabilities,
  persistence?: WorkbenchPersistence,
  panels?: WorkbenchPanels,
): WorkbenchController {
  let restored: WorkbenchSnapshot | null = null;
  const listeners = new Set<() => void>();

  const waiting = new Map<
    WorkbenchTabId,
    { readonly view: WorkbenchViewKey; readonly tab: WorkbenchTab; activate: boolean }
  >();

  const read = (): WorkbenchSnapshot =>
    (restored ??= restoreSnapshot(persistence?.get(), capabilities));

  const publish = (key: WorkbenchViewKey, view: WorkbenchViewState): void => {
    const views = new Map(read().views);
    views.set(key, freezeView(view));
    const snapshot = Object.freeze({ views });
    restored = snapshot;
    persistence?.set(persistable(snapshot));

    for (const listener of listeners) listener();
  };

  const update = (
    key: WorkbenchViewKey,
    change: (current: WorkbenchViewState) => WorkbenchViewState,
  ): void => {
    const current = read().views.get(key) ?? DEFAULT_VIEW;
    const next = change(current);

    if (next !== current) publish(key, next);
  };

  const addTab = (view: WorkbenchViewKey, tab: WorkbenchTab, activate: boolean): void => {
    const current = read().views.get(view) ?? DEFAULT_VIEW;
    publish(view, {
      ...current,
      tabs: [...current.tabs, tab],
      active: activate ? tab.id : current.active,
      expanded: activate ? true : current.expanded,
      layout: activate ? revealWorkbench(current.layout) : current.layout,
    });
  };

  const actions: WorkbenchController["actions"] = {
    openTab({ view, tab, activate }) {
      const current = read().views.get(view) ?? DEFAULT_VIEW;
      const existing = current.tabs.find((candidate) => sameTab(candidate, tab));

      if (existing !== undefined) {
        const layout = revealWorkbench(current.layout);

        if (
          activate &&
          (current.active !== existing.id || !current.expanded || layout !== current.layout)
        ) {
          publish(view, { ...current, active: existing.id, expanded: true, layout });
        }

        return existing.id;
      }

      const pending = [...waiting.values()].find(
        (entry) => entry.view === view && sameTab(entry.tab, tab),
      );

      if (pending !== undefined) {
        pending.activate ||= activate;

        return pending.tab.id;
      }

      const next = { id: crypto.randomUUID(), ...tab } satisfies WorkbenchTab;

      if (
        tab.kind === "browser" ||
        tab.kind === "canvas" ||
        panels === undefined ||
        panels.ready()
      ) {
        addTab(view, next, activate);

        return next.id;
      }

      waiting.set(next.id, { view, tab: next, activate });

      const add = (): void => {
        const entry = waiting.get(next.id);

        if (entry === undefined) return;
        waiting.delete(next.id);
        addTab(entry.view, entry.tab, entry.activate);
      };

      void panels.load().then(add, add);

      return next.id;
    },
    activateTab({ view, id }) {
      update(view, (current) => {
        if (!current.tabs.some((tab) => tab.id === id)) return current;
        const layout = revealWorkbench(current.layout);

        return current.active === id && current.expanded && layout === current.layout
          ? current
          : { ...current, active: id, expanded: true, layout };
      });
    },
    closeTab({ view, id }) {
      update(view, (current) => {
        const index = current.tabs.findIndex((tab) => tab.id === id);

        if (index === -1) return current;
        const tabs = current.tabs.filter((tab) => tab.id !== id);

        const active =
          current.active === id ? (tabs[index]?.id ?? tabs[index - 1]?.id ?? null) : current.active;

        return { ...current, tabs, active, expanded: current.expanded && active !== null };
      });
    },
    moveTab({ view, id, index }) {
      update(view, (current) => {
        const from = current.tabs.findIndex((tab) => tab.id === id);

        if (from === -1) return current;
        const target = Math.max(0, Math.min(current.tabs.length - 1, Math.round(index)));

        if (from === target) return current;
        const tabs = [...current.tabs];
        const [tab] = tabs.splice(from, 1);

        if (tab === undefined) return current;
        tabs.splice(target, 0, tab);

        return { ...current, tabs };
      });
    },
    updateTab(input) {
      const pending = waiting.get(input.id);

      if (pending?.view === input.view) {
        waiting.set(input.id, { ...pending, tab: patchTab(pending.tab, input) });

        return;
      }

      update(input.view, (current) => {
        const tab = current.tabs.find((candidate) => candidate.id === input.id);

        if (tab === undefined) return current;
        const next = patchTab(tab, input);

        if (next === tab) return current;

        return {
          ...current,
          tabs: current.tabs.map((candidate) => (candidate === tab ? next : candidate)),
        };
      });
    },
    scrollTab({ view, id, scrollTop }) {
      update(view, (current) => {
        const tab = current.tabs.find((candidate) => candidate.id === id);

        if (tab === undefined || tab.kind !== "changes" || tab.scrollTop === scrollTop)
          return current;

        return {
          ...current,
          tabs: current.tabs.map((candidate) =>
            candidate === tab ? { ...tab, scrollTop } : candidate,
          ),
        };
      });
    },
    toggle({ view }) {
      update(view, (current) => ({
        ...current,
        expanded: !current.expanded,
        layout: current.expanded ? current.layout : revealWorkbench(current.layout),
      }));
    },
    toggleCollapsed({ view }) {
      update(view, (current) => ({
        ...current,
        collapsed: current.collapsed === "floating" ? "compact" : "floating",
      }));
    },
    toggleMaximized({ view }) {
      update(view, (current) => ({
        ...current,
        layout: current.layout.kind === "maximized" ? SPLIT_LAYOUT : MAXIMIZED_WORKBENCH_LAYOUT,
      }));
    },
    showChat({ view }) {
      update(view, (current) =>
        current.layout.kind === "maximized" && !workbenchShowsChat(current.layout)
          ? { ...current, layout: MAXIMIZED_CHAT_LAYOUT }
          : current,
      );
    },
    toggleWorkbench({ view }) {
      actions.toggle({ view });
    },
    setShare({ view, share }) {
      const width = shareWidth(share);
      update(view, (current) =>
        current.width.kind === "share" && current.width.share === width.share
          ? current
          : { ...current, width },
      );
    },
  };

  return Object.freeze({
    subscribe(listener: () => void) {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    getSnapshot: read,
    getView: (key: WorkbenchViewKey) => read().views.get(key) ?? DEFAULT_VIEW,
    actions: Object.freeze(actions),
  });
}

export const workbenchController = createWorkbenchController(
  () => clientCapabilities(nyte.host),
  workbenchPersistence(),
  {
    ready: () => readDeferred("workbench") !== undefined,
    load: async () => {
      await loadDeferred("workbench");
    },
  },
);

export function useWorkbenchSnapshot(): WorkbenchSnapshot {
  return useSyncExternalStore(
    workbenchController.subscribe,
    workbenchController.getSnapshot,
    workbenchController.getSnapshot,
  );
}

/** The workbench tab drawing this canvas while it is on screen beside the chat. */
export function useVisibleCanvasTab(
  workspacePath: string | undefined,
  canvas: { readonly sessionId: SessionId; readonly part: PartId } | undefined,
): WorkbenchTabId | undefined {
  const read = (): WorkbenchTabId | undefined => {
    if (canvas === undefined) return undefined;

    const tab = shownWorkbenchTab(
      workbenchController.getView(workbenchViewKey(workspacePath)),
      workbenchScope(workspacePath),
      clientCapabilities(nyte.host),
    );

    return tab?.kind === "canvas" && tab.sessionId === canvas.sessionId && tab.part === canvas.part
      ? tab.id
      : undefined;
  };

  return useSyncExternalStore(workbenchController.subscribe, read, read);
}
