import {
  agentVisibilityScript,
  visibilityParent,
  visibilityChild,
} from "./agents-visibility-preload.ts";
import { QueryClientProvider } from "@tanstack/react-query";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { AgentsPanel } from "./agents-panel.tsx";
import { agentActions } from "./agents-store.ts";
import { keys, queryClient } from "../queries.ts";
import "../theme/tokens.css";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function until(predicate: () => boolean): Promise<void> {
  const deadline = performance.now() + 5_000;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error("Agent visibility update timed out");
    await new Promise<void>((resolve) => window.setTimeout(resolve, 10));
  }
}

/** Load in a standalone browser page, not the app's real preload. */
export async function run(): Promise<string> {
  const container = document.createElement("div");
  container.style.cssText = "display:flex;height:300px;width:600px";
  document.body.append(container);
  const root = createRoot(container);
  const render = (visible: boolean) =>
    flushSync(() =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <AgentsPanel owner="visibility-test" sessionId={visibilityParent} visible={visible} />
        </QueryClientProvider>,
      ),
    );
  const scrollport = () => {
    const element = container.querySelector("[data-nyte-scrollport]");
    if (!(element instanceof HTMLDivElement)) throw new Error("Missing agent scrollport");
    return element;
  };
  const observers = () =>
    queryClient
      .getQueryCache()
      .getAll()
      .reduce((count, query) => count + query.getObserversCount(), 0);
  try {
    agentActions.select("visibility-test", visibilityChild);
    render(false);
    check(container.textContent === "", "Initially hidden panels must not mount content");
    check(
      agentVisibilityScript.snapshots === 0 && agentVisibilityScript.jobsReads === 0,
      "Initially hidden panels must not fetch",
    );
    render(true);
    await until(() => agentVisibilityScript.activeWatches === 1);
    check(container.textContent?.includes("Selected agent") === true, "Retain the selected child");
    check(scrollport().scrollTop > 0, "Initial follow pins the newest output");
    check(
      agentVisibilityScript.activeClocks.size === 1,
      "Running agents have one elapsed-time clock",
    );
    scrollport().scrollTop = 120;
    scrollport().dispatchEvent(new Event("scroll", { bubbles: true }));
    render(false);
    await until(() => agentVisibilityScript.activeWatches === 0 && observers() === 0);
    check(agentVisibilityScript.unwatches === 1, "Hiding disposes the child watch");
    check(agentVisibilityScript.activeClocks.size === 0, "Hiding stops the elapsed-time clock");
    check(agentVisibilityScript.cancellations === 0, "Hiding must not cancel the running job");
    const reads = agentVisibilityScript.jobsReads;
    const snapshots = agentVisibilityScript.snapshots;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 2_100));
    check(
      agentVisibilityScript.jobsReads === reads && agentVisibilityScript.snapshots === snapshots,
      "Hidden panels must not poll or refresh snapshots",
    );

    agentVisibilityScript.snapshot.seq = 9;
    render(true);
    await until(() => agentVisibilityScript.activeWatches === 1);
    const reopenedWatch = agentVisibilityScript.cursors.at(-1);
    check(
      reopenedWatch !== undefined && "afterSeq" in reopenedWatch && reopenedWatch.afterSeq === 9,
      "Reopen must watch from a fresh coherent snapshot, not the cached cursor",
    );
    check(scrollport().scrollTop === 120, "Reopening restores the unpinned reading position");
    check(container.textContent?.includes("Selected agent") === true, "Reopening keeps selection");
    scrollport().scrollTop = scrollport().scrollHeight;
    scrollport().dispatchEvent(new Event("scroll", { bubbles: true }));
    render(false);
    await until(() => agentVisibilityScript.activeWatches === 0);
    agentVisibilityScript.jobs = agentVisibilityScript.jobs.map((job) => ({
      ...job,
      state: "completed",
      updatedAt: job.startedAt + 5_000,
    }));
    agentVisibilityScript.snapshot.seq = 12;
    // An expired cache must not erase a retained reading position while loading.
    queryClient.removeQueries({ queryKey: keys.snapshot(visibilityChild), exact: true });
    render(true);
    await until(() => container.textContent?.includes("Completed after 5s") === true);
    check(scrollport().scrollTop > 120, "Pinned readers resume following after reopening");
    check(
      container.querySelector('[aria-label="Stop agent"]') === null,
      "Completion while hidden removes the stop action",
    );
    check(container.textContent?.includes("Answer 39") === true, "Final results remain readable");
    render(false);
    await until(() => agentVisibilityScript.activeWatches === 0);
    agentVisibilityScript.failSnapshot = true;
    render(true);
    await until(() => container.querySelector('[role="alert"]') !== null);
    check(agentVisibilityScript.activeWatches === 0, "Failed refresh must not start a stale watch");
    agentVisibilityScript.failSnapshot = false;
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Try again",
    );
    if (retry === undefined) throw new Error("Missing snapshot retry");
    retry.click();
    await until(() => agentVisibilityScript.activeWatches === 1);
    check(agentVisibilityScript.cancellations === 0, "Visibility and retry never cancel jobs");
    return "passed";
  } finally {
    flushSync(() => root.unmount());
    agentActions.clear("visibility-test");
    queryClient.clear();
    container.remove();
  }
}
