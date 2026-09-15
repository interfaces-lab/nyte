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
import type { SessionSnapshot } from "@nyte-ai/core";
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

/** The same wiring workbench.tsx gives the panel: controller state in, controller actions out. */
function Host({ withSession }: { readonly withSession: boolean }): ReactElement {
  const snapshot = useWorkbenchSnapshot();
  const view = snapshot.views.get(viewKey) ?? workbenchController.getView(viewKey);
  return (
    <ChangesPanel
      sessionId={withSession ? changesSession : undefined}
      scope={view.changesScope}
      selectedPath={view.selectedPath}
      revealPathRevision={view.pathRevealRevision}
      scrollTop={view.scrollTop.changes}
      fileTreeVisible={true}
      onScopeChange={(scope) => workbenchController.actions.selectChangesScope(viewKey, scope)}
      onToggleFileTree={() => {}}
      onSelectPath={(path) => workbenchController.actions.selectPath(viewKey, path)}
      onRevealPath={(path) => workbenchController.actions.revealPath(viewKey, path)}
      onScrollTop={(top) => workbenchController.actions.setScrollTop(viewKey, "changes", top)}
    />
  );
}

interface Observation {
  readonly step: string;
  readonly scopeKind: string;
  readonly scopeTurnId: string | null;
  readonly scopeLabel: string | null;
  readonly alert: string | null;
  readonly treeFiles: readonly string[];
  readonly stackPaths: readonly string[];
  readonly snapshotReads: number;
  readonly watches: number;
  readonly unwatches: number;
  readonly queryStatus: string;
  readonly fetchStatus: string;
  readonly queryError: string | null;
  readonly cachedTurnIds: readonly string[];
  readonly observers: number;
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
    const state = snapshotState();
    const data = state?.data;
    const scope = workbenchController.getView(viewKey).changesScope;
    const observation: Observation = {
      step,
      scopeKind: scope.kind,
      scopeTurnId: scope.kind === "turn" ? scope.turnId : null,
      scopeLabel: trigger().getAttribute("aria-label"),
      alert: text(container.querySelector('[role="alert"]')),
      treeFiles: Array.from(container.querySelectorAll('[role="treeitem"]')).map(
        (item) => item.getAttribute("title") ?? "",
      ),
      stackPaths: Array.from(container.querySelectorAll("[data-change-path]")).map(
        (item) => item.getAttribute("data-change-path") ?? "",
      ),
      snapshotReads: changesScopeScript.snapshotReads,
      watches: changesScopeScript.watches,
      unwatches: changesScopeScript.unwatches,
      queryStatus: state?.status ?? "absent",
      fetchStatus: state?.fetchStatus ?? "absent",
      queryError: state?.error?.message ?? null,
      cachedTurnIds:
        data === undefined
          ? []
          : data.transcript.map((turn) => (turn.kind === "turn" ? turn.id : turn.kind)),
      observers:
        queryClient
          .getQueryCache()
          .find({ queryKey: keys.snapshot(changesSession) })
          ?.getObserversCount() ?? 0,
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

    await selectScope("Latest");
    await selectScope("Turn 2");
    await selectScope("Uncommitted");
    await selectScope("Turn 1");
    observe("after four more scope changes");

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
    observe("picked Uncommitted while a dropped turn was still stored");

    restoreTranscript();
    await settle();
    observe("transcript regained the turn after picking Uncommitted");

    await selectScope("Turn 2");
    observe("reselected a present turn");

    // A read held open, then cancelled by the query layer while the panel stays mounted.
    changesScopeScript.hangSnapshot = true;
    void queryClient.refetchQueries({ queryKey: keys.snapshot(changesSession), exact: true });
    await until(() => snapshotState()?.fetchStatus === "fetching", "a read in flight");
    observe("read in flight");
    await selectScope("Latest");
    observe("scope changed while the read was in flight");
    await queryClient.cancelQueries({ queryKey: keys.snapshot(changesSession), exact: true });
    await settle();
    observe("in-flight read cancelled, reverting");
    releaseSnapshot();
    changesScopeScript.hangSnapshot = false;
    await settle();
    observe("after the cancelled read resolved");

    // The same cancellation without a revert.
    changesScopeScript.hangSnapshot = true;
    void queryClient.refetchQueries({ queryKey: keys.snapshot(changesSession), exact: true });
    await until(() => snapshotState()?.fetchStatus === "fetching", "a second read in flight");
    await queryClient.cancelQueries(
      { queryKey: keys.snapshot(changesSession), exact: true },
      { revert: false },
    );
    await settle();
    observe("in-flight read cancelled without revert");
    releaseSnapshot();
    await settle();

    // The panel leaves while its read is open: the read's own abort path runs.
    void queryClient.refetchQueries({ queryKey: keys.snapshot(changesSession), exact: true });
    await until(() => snapshotState()?.fetchStatus === "fetching", "a third read in flight");
    render(false);
    await settle();
    observe("unmounted while the read was in flight");
    releaseSnapshot();
    changesScopeScript.hangSnapshot = false;
    render(true);
    await until(() => snapshotState()?.fetchStatus === "idle", "the remounted read");
    await settle();
    observe("remounted after the aborted read");

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
      () => container.querySelectorAll('[role="treeitem"]').length === 0,
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
