// Load in a standalone browser page, not the app's real preload.
import {
  changesScopeScript,
  changesSession,
  releaseSnapshot,
  snapshotWith,
  firstTurn,
  secondTurn,
  thirdTurn,
} from "./changes-scope-preload.ts";
import { QueryClientProvider } from "@tanstack/react-query";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ReactElement } from "react";
import type { SessionSnapshot } from "@nyte-ai/protocol";
import { keys, queryClient } from "../queries.ts";
import { ChangesPanel } from "./changes-panel.tsx";
import {
  useWorkbenchSnapshot,
  workbenchController,
  workbenchViewKey,
  type WorkbenchViewKey,
} from "./controller.ts";
import "../theme/tokens.css";

const viewKey: WorkbenchViewKey = workbenchViewKey({
  paneKey: "changes-scope",
  target: { kind: "session", sessionId: changesSession },
});

const changesTabId = workbenchController.actions.openTab({
  view: viewKey,
  tab: {
    kind: "changes",
    scope: { kind: "uncommitted" },
    selectedPath: null,
    pathRevealRevision: 0,
    scrollTop: 0,
  },
  activate: true,
});

function changesTab() {
  const tab = workbenchController
    .getView(viewKey)
    .tabs.find((candidate) => candidate.id === changesTabId);
  if (tab?.kind !== "changes") throw new Error("Missing Changes tab");
  return tab;
}

/** The same wiring workbench.tsx gives the panel: controller state in, controller actions out. */
function Host({ withSession }: { readonly withSession: boolean }): ReactElement {
  useWorkbenchSnapshot();
  const tab = changesTab();
  const update = (patch: {
    readonly scope: typeof tab.scope;
    readonly selectedPath: string | null;
    readonly pathRevealRevision: number;
    readonly scrollTop: number;
  }): void =>
    workbenchController.actions.updateTab({
      view: viewKey,
      id: changesTabId,
      kind: "changes",
      patch,
    });
  return (
    <ChangesPanel
      sessionId={withSession ? changesSession : undefined}
      scope={tab.scope}
      selectedPath={tab.selectedPath ?? undefined}
      revealPathRevision={tab.pathRevealRevision}
      scrollTop={tab.scrollTop}
      fileTreeVisible={true}
      onScopeChange={(scope) => update({ ...tab, scope, selectedPath: null, scrollTop: 0 })}
      onToggleFileTree={() => {}}
      onSelectPath={(path) => update({ ...tab, selectedPath: path ?? null })}
      onRevealPath={(path) =>
        update({
          ...tab,
          selectedPath: path,
          pathRevealRevision: tab.pathRevealRevision + 1,
        })
      }
      onScrollTop={(scrollTop) => update({ ...tab, scrollTop })}
    />
  );
}

interface Observation {
  readonly step: string;
  readonly scopeLabel: string | null;
  readonly alert: string | null;
  readonly stackPaths: readonly string[];
  readonly snapshotReads: number;
}

async function until(predicate: () => boolean, what: string): Promise<void> {
  const deadline = performance.now() + 5_000;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 10));
  }
}

async function settle(): Promise<void> {
  for (let index = 0; index < 4; index += 1) {
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  }
}

export async function run(): Promise<string> {
  const container = document.createElement("div");
  container.style.cssText = "display:flex;height:600px;width:900px";
  document.body.append(container);
  const root = createRoot(container);
  const render = (withSession = true): void => {
    flushSync(() =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <Host withSession={withSession} />
        </QueryClientProvider>,
      ),
    );
  };
  const text = (element: Element | null): string | null =>
    element === null ? null : (element.textContent ?? "");
  const trigger = (): HTMLElement => {
    const found = container.querySelector('[aria-label^="Showing "]');
    if (!(found instanceof HTMLElement)) throw new Error("Missing scope trigger");
    return found;
  };
  const snapshotState = () =>
    queryClient.getQueryState<SessionSnapshot>(keys.snapshot(changesSession));
  const observations: Observation[] = [];
  const observe = (step: string): void => {
    const observation: Observation = {
      step,
      scopeLabel: trigger().getAttribute("aria-label"),
      alert: text(container.querySelector('[role="alert"]')),
      stackPaths: Array.from(container.querySelectorAll("[data-change-path]")).map(
        (item) => item.getAttribute("data-change-path") ?? "",
      ),
      snapshotReads: changesScopeScript.snapshotReads,
    };
    observations.push(observation);
  };

  /** Pick a turn the way a reader does: open the dropdown and click its radio item. */
  const selectScope = async (menuLabel: string): Promise<void> => {
    trigger().click();
    await until(
      () => document.querySelectorAll('[role="menuitemradio"]').length > 0,
      "the scope menu to open",
    );
    const item = Array.from(document.querySelectorAll('[role="menuitemradio"]')).find((candidate) =>
      (candidate.textContent ?? "").startsWith(menuLabel),
    );
    if (!(item instanceof HTMLElement)) {
      const listed = Array.from(document.querySelectorAll('[role="menuitemradio"]'))
        .map((candidate) => candidate.textContent ?? "")
        .join(" | ");
      throw new Error(`Missing menu item ${menuLabel} among: ${listed}`);
    }
    item.click();
    await until(
      () => document.querySelectorAll('[role="menuitemradio"]').length === 0,
      "the scope menu to close",
    );
    await settle();
  };

  const remount = async (): Promise<void> => {
    render(false);
    await settle();
    render(true);
    await settle();
  };

  try {
    render();
    await until(() => snapshotState()?.status === "success", "the first transcript read");
    await until(() => queryClient.getQueryData(keys.vcsSnapshot) !== undefined, "the VCS read");
    await settle();
    observe("mounted on uncommitted");

    await selectScope("Latest");
    observe("selected the newest turn");

    await selectScope("Turn 1");
    observe("selected an older turn");

    // A rebase publishes a transcript through this exact call in live.ts.
    const dropSelectedTurn = (): void => {
      changesScopeScript.transcript = [firstTurn, secondTurn];
      queryClient.setQueryData(keys.snapshot(changesSession), snapshotWith([secondTurn]));
    };
    const restoreTranscript = (): void => {
      changesScopeScript.transcript = [firstTurn, secondTurn, thirdTurn];
      queryClient.setQueryData(
        keys.snapshot(changesSession),
        snapshotWith(changesScopeScript.transcript),
      );
    };

    dropSelectedTurn();
    await settle();
    observe("selected turn dropped from the transcript");

    restoreTranscript();
    await settle();
    observe("transcript regained the dropped turn");

    dropSelectedTurn();
    await settle();
    await selectScope("Uncommitted");

    restoreTranscript();
    await settle();
    observe("transcript regained the turn after picking Uncommitted");

    changesScopeScript.hangSnapshot = true;
    void queryClient.refetchQueries({ queryKey: keys.snapshot(changesSession), exact: true });
    await until(() => snapshotState()?.fetchStatus === "fetching", "a read in flight");
    observe("read in flight");
    await selectScope("Latest");
    observe("scope changed while the read was in flight");
    releaseSnapshot();
    changesScopeScript.hangSnapshot = false;
    await until(() => snapshotState()?.fetchStatus === "idle", "the held read to finish");

    // A read that fails outright, with cached turns still in place.
    changesScopeScript.failSnapshot = true;
    await queryClient
      .refetchQueries({ queryKey: keys.snapshot(changesSession), exact: true })
      .catch(() => undefined);
    await until(() => snapshotState()?.status === "error", "the failed read");
    await settle();
    observe("read failed with cached turns");

    // The same failure with nothing cached: the panel has no turns at all.
    queryClient.removeQueries({ queryKey: keys.snapshot(changesSession), exact: true });
    await remount();
    await until(() => snapshotState()?.status === "error", "the failed read without cache");
    await settle();
    observe("read failed with no cached turns, dirty working tree");

    changesScopeScript.vcsFiles = [];
    await queryClient.invalidateQueries({ queryKey: keys.vcsSnapshot, exact: true });
    await until(
      () => container.querySelector("[data-change-path]") === null,
      "the clean working tree",
    );
    await settle();
    observe("read failed with no cached turns, clean working tree");

    changesScopeScript.failSnapshot = false;
    changesScopeScript.vcsFiles = [{ path: "src/working.ts", kind: "modified" }];
    await queryClient.invalidateQueries({ queryKey: keys.vcsSnapshot, exact: true });
    await queryClient.refetchQueries({ queryKey: keys.snapshot(changesSession), exact: true });
    await until(() => snapshotState()?.status === "success", "recovery");
    await settle();
    observe("recovered");

    return JSON.stringify(observations);
  } catch (error) {
    return JSON.stringify({
      failure: error instanceof Error ? (error.stack ?? error.message) : String(error),
      observations,
    });
  } finally {
    flushSync(() => root.unmount());
    queryClient.clear();
    container.remove();
  }
}
