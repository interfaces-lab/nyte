/**
 * Drives the changes panel's revert in a real renderer: the confirmation each
 * kind of file gets, the call the panel makes, the refreshed working tree, a
 * skipped path that is not an error, and the review mark a revert clears.
 */
import { revertScript, TRACKED, UNTRACKED } from "./changes-revert-preload.ts";
import { QueryClientProvider } from "@tanstack/react-query";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { queryClient, refreshVcs } from "../queries.ts";
import { ChangesPanel } from "./changes-panel.tsx";
import "../theme/tokens.css";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function until(predicate: () => boolean, what: string, timeoutMs = 5_000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 10));
  }
}

export async function run(): Promise<string> {
  const container = document.createElement("div");
  container.style.cssText = "display:flex;height:600px;width:900px";
  document.body.append(container);
  const root = createRoot(container);

  const render = ({
    scope = "uncommitted",
    visible = true,
  }: {
    readonly scope?: "uncommitted" | "unstaged";
    readonly visible?: boolean;
  } = {}): void =>
    flushSync(() =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ChangesPanel
            visible={visible}
            sessionId={undefined}
            scope={{ kind: scope }}
            selectedPath={undefined}
            revealPathRevision={0}
            scrollTop={0}
            fileTreeVisible={true}
            onScopeChange={() => {}}
            onToggleFileTree={() => {}}
            onSelectPath={() => {}}
            onRevealPath={() => {}}
            onScrollTop={() => {}}
          />
        </QueryClientProvider>,
      ),
    );

  const rows = (): readonly string[] =>
    Array.from(
      container
        .querySelector("file-tree-container")
        ?.shadowRoot?.querySelectorAll('[role="treeitem"]') ?? [],
    ).map((row) => row.getAttribute("data-item-path") ?? "");
  const button = (label: string): HTMLButtonElement => {
    const found = container.querySelector(`button[aria-label="${label}"]`);
    if (!(found instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`);
    return found;
  };
  // The confirmation is portalled out of the panel, so it is read from the page.
  const dialog = (): HTMLElement | null => document.querySelector('[role="alertdialog"]');
  const dialogText = (): string => dialog()?.textContent ?? "";
  const dialogButton = (label: string): HTMLButtonElement => {
    const found = Array.from(dialog()?.querySelectorAll("button") ?? []).find(
      (item) => item.textContent?.trim() === label,
    );
    if (found === undefined) throw new Error(`Missing dialog button: ${label} in ${dialogText()}`);
    return found;
  };
  const reviewCheckbox = (path: string): HTMLElement => {
    const header = Array.from(container.querySelectorAll("[data-change-path]")).find(
      (item) => item.getAttribute("data-change-path") === path,
    );
    const found = header?.querySelector('[role="checkbox"]');
    if (!(found instanceof HTMLElement)) throw new Error(`Missing review checkbox for ${path}`);
    return found;
  };

  try {
    render();
    await until(() => rows().includes(UNTRACKED), "the working tree to load");

    for (const scope of ["unstaged", "uncommitted"] as const) {
      render({ scope });
      check(
        container.querySelectorAll('file-tree-container[aria-label="Changed files"]').length === 1,
        `Exactly one changes tree after switching to ${scope}`,
      );
    }

    await until(() => queryClient.isFetching({ queryKey: ["vcs"] }) === 0, "the diffs to load");
    const tree = container.querySelector('file-tree-container[aria-label="Changed files"]');
    const snapshotReads = revertScript.snapshotReads;
    const diffReads = revertScript.diffReads;
    refreshVcs();
    await until(
      () =>
        revertScript.snapshotReads > snapshotReads &&
        queryClient.isFetching({ queryKey: ["vcs"] }) === 0,
      "the unchanged status refresh",
    );
    check(revertScript.diffReads === diffReads, "An unchanged status does not reload diffs");
    check(
      container.querySelector('file-tree-container[aria-label="Changed files"]') === tree,
      "Status refresh preserves the tree",
    );

    render({ visible: false });
    const hiddenReads = revertScript.snapshotReads;
    refreshVcs();
    await until(
      () => queryClient.isFetching({ queryKey: ["vcs"] }) === 0,
      "hidden refresh to settle",
    );
    check(
      revertScript.snapshotReads === hiddenReads,
      "A hidden changes panel does not read status",
    );
    check(revertScript.diffReads === diffReads, "A hidden changes panel does not read diffs");
    render();
    await until(() => revertScript.snapshotReads > hiddenReads, "status refresh when shown again");
    check(
      container.querySelector('file-tree-container[aria-label="Changed files"]') === tree,
      "Showing the panel preserves the tree",
    );

    await until(
      () => container.querySelector(`button[aria-label="Revert ${TRACKED}"]`) !== null,
      "the diff actions to render",
    );

    // A tracked file is warned about in terms of the commit it goes back to.
    button(`Revert ${TRACKED}`).click();
    await until(() => dialog() !== null, "the tracked confirmation");
    check(dialogText().includes(TRACKED), "The confirmation names the file");
    check(dialogText().includes("can’t be undone"), `Tracked warning: ${dialogText()}`);
    check(revertScript.reverts.length === 0, "Confirming is what reverts, not opening the dialog");

    // Cancelling reverts nothing and leaves the file alone.
    dialogButton("Cancel").click();
    await until(() => dialog() === null, "the confirmation to close");
    check(revertScript.reverts.length === 0, "A cancelled confirmation calls nothing");
    check(rows().includes(TRACKED), "The cancelled file is still listed");

    // A path the working tree no longer reports is skipped with its reason, not thrown.
    revertScript.skipReason = "This file has no changes to revert.";
    button(`Revert ${TRACKED}`).click();
    await until(() => dialog() !== null, "the confirmation to reopen");
    dialogButton("Revert").click();
    await until(
      () => dialogText().includes("no changes to revert"),
      `the skip reason: ${dialogText()}`,
    );
    check(dialog() !== null, "A skipped path keeps the confirmation open");
    check(rows().includes(TRACKED), "A skipped path stays in the working tree");
    dialogButton("Cancel").click();
    await until(() => dialog() === null, "the confirmation to close again");

    // An untracked file is described as going to the trash, with no undo claim.
    reviewCheckbox(UNTRACKED).click();
    await until(
      () => reviewCheckbox(UNTRACKED).getAttribute("aria-checked") === "true",
      "the untracked file to be marked viewed",
    );
    button(`Revert ${UNTRACKED}`).click();
    await until(() => dialog() !== null, "the untracked confirmation");
    check(dialogText().includes("moves the file to the trash"), `Untracked copy: ${dialogText()}`);
    check(!dialogText().includes("undone"), "The trash is recoverable, so nothing claims an undo");

    dialogButton("Move to Trash").click();
    await until(() => revertScript.reverts.length === 2, "the revert call");
    check(
      revertScript.reverts[1]?.paths.join(",") === UNTRACKED,
      `The revert names one path: ${String(revertScript.reverts[1]?.paths.join(","))}`,
    );
    await until(() => dialog() === null, "the confirmation to close after reverting");
    // The refreshed read is what removes the row, and it is the revert that asks
    // for it: the working tree also polls, so this window is shorter than a poll.
    await until(
      () => !rows().includes(UNTRACKED),
      "the reverted file to leave the working tree",
      1_500,
    );

    // The same path written again is a new file, not one this reader already reviewed.
    revertScript.files = [...revertScript.files, { path: UNTRACKED, kind: "untracked" }];
    revertScript.revision += 1;
    button("Refresh changes").click();
    await until(() => rows().includes(UNTRACKED), "the file to come back");
    // A surviving mark would read as "changed" here, since the patch is read again.
    check(
      reviewCheckbox(UNTRACKED).getAttribute("data-viewed-state") === "unviewed",
      `A reverted file's review mark is cleared: ${String(reviewCheckbox(UNTRACKED).getAttribute("data-viewed-state"))}`,
    );

    return "passed";
  } catch (error) {
    return error instanceof Error ? (error.stack ?? error.message) : String(error);
  } finally {
    root.unmount();
    container.remove();
  }
}
