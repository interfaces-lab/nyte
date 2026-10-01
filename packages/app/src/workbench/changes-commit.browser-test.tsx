/**
 * Drives the Changes tab's commit surface in a real renderer: what the primary
 * action runs, what each refused outcome says, and what a retry repeats.
 *
 * The bar is the only place the desktop writes to Git from the Changes tab, so
 * every check here is about the call made and the words shown afterwards.
 */
import { CHANGED, commitScript } from "./changes-commit-preload.ts";
import "../../test/window-bridge.ts";
import { QueryClientProvider } from "@tanstack/react-query";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { queryClient } from "../queries.ts";
import { ChangesPanel } from "./changes-panel.tsx";
import { applyDisplayMode } from "../theme/appearance.ts";
import "../theme/tokens.stylex.ts";

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
  container.style.cssText = "display:flex;height:700px;width:900px";
  document.body.append(container);
  const root = createRoot(container);

  const render = (): void =>
    flushSync(() =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ChangesPanel
            sessionId={undefined}
            scope={{ kind: "uncommitted" }}
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

  const field = (label: string): HTMLInputElement => {
    const found = container.querySelector(`input[aria-label="${label}"]`);
    if (!(found instanceof HTMLInputElement)) throw new Error(`Missing field: ${label}`);
    return found;
  };
  /** Types into the field the way a reader does, so React sees a real edit. */
  const type = async (label: string, value: string): Promise<void> => {
    await until(() => !field(label).disabled, `the ${label} field to accept typing`);
    const input = field(label);
    input.focus();
    input.select();
    if (input.value !== "") document.execCommand("delete");
    if (value !== "") document.execCommand("insertText", false, value);
  };
  const buttonNamed = (name: string, scope: ParentNode = container): HTMLButtonElement => {
    const found = Array.from(scope.querySelectorAll("button")).find(
      (item) => item.textContent?.trim() === name || item.getAttribute("aria-label") === name,
    );
    if (found === undefined) throw new Error(`Missing button: ${name}`);
    return found;
  };
  const primary = (): HTMLButtonElement => {
    const found = Array.from(container.querySelectorAll("button")).find((item) =>
      /^(Commit|Create Branch|Push|Create Pull Request)/.test(item.textContent?.trim() ?? ""),
    );
    if (found === undefined) throw new Error("Missing the primary commit action");
    return found;
  };
  const report = (): string =>
    Array.from(container.querySelectorAll('[role="status"], [role="alert"]'))
      .map((node) => node.textContent ?? "")
      .join(" ");
  // The action menu is portalled out of the panel, so it is read from the page.
  const openActionMenu = async (): Promise<HTMLElement> => {
    buttonNamed("More commit actions").click();
    await until(() => document.querySelector('[role="menu"]') !== null, "the menu");
    const menu = document.querySelector('[role="menu"]');
    if (!(menu instanceof HTMLElement)) throw new Error("Missing the commit actions menu");
    return menu;
  };
  const menuItem = (menu: HTMLElement, name: string): HTMLElement => {
    const found = Array.from(menu.querySelectorAll('[role="menuitem"]')).find((item) =>
      (item.textContent ?? "").startsWith(name),
    );
    if (!(found instanceof HTMLElement)) throw new Error(`Missing menu item: ${name}`);
    return found;
  };
  /** A committed tree is empty; the next case needs a change and a read that sees it. */
  const restoreWorkingTree = (): void => {
    commitScript.files = [{ path: CHANGED, kind: "modified" }];
    commitScript.revision += 1;
    buttonNamed("Refresh changes").click();
  };

  try {
    render();
    await until(
      () => container.querySelector('input[aria-label="Commit message"]') !== null,
      "bar",
    );

    // The default action cannot run without a message.
    check(
      primary().textContent?.trim() === "Commit and Push Changes",
      `Default action: ${String(primary().textContent)}`,
    );
    check(
      primary().getAttribute("aria-disabled") === "true",
      "An empty message cannot be committed",
    );
    const disabledMenu = await openActionMenu();
    const disabledCommit = menuItem(disabledMenu, "Commit Changes");
    check(
      disabledCommit.getAttribute("aria-disabled") === "true",
      "The commit action is unavailable without a message",
    );
    disabledMenu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await until(() => document.querySelector('[role="menu"]') === null, "the menu to close");

    await type("Commit message", "feat(desktop): add the commit bar");
    await until(
      () => primary().getAttribute("aria-disabled") !== "true",
      "the action to become available",
    );
    const form = field("Commit message").form;
    check(form !== null, "The single-line message belongs to a submit form");
    form?.requestSubmit();
    await until(() => commitScript.commits.length === 1, "the commit call");
    check(
      commitScript.commits[0]?.message === "feat(desktop): add the commit bar",
      "The commit carries the typed message",
    );
    check(
      commitScript.commits[0]?.target.kind === "all",
      "An uncommitted scope commits every tracked change",
    );
    await until(() => commitScript.pushes.length === 1, "the push call");
    await until(() => report().includes("Pushed main to origin."), `push report: ${report()}`);
    check(report().includes("Committed 1234567"), `commit report: ${report()}`);
    check(field("Commit message").value === "", "A committed message leaves the field");

    // A branch that tracks nothing is offered publishing, and the retry sets upstream
    // without committing a second time.
    restoreWorkingTree();
    commitScript.pushResults = [
      { kind: "no_upstream", branch: "feature" },
      { kind: "pushed", remote: "origin", branch: "feature" },
    ];
    await type("Commit message", "fix(desktop): report a push");
    await until(
      () => primary().getAttribute("aria-disabled") !== "true",
      "the action to become available again",
    );
    primary().click();
    await until(() => report().includes("tracks no remote branch yet"), `no upstream: ${report()}`);
    check(commitScript.commits.length === 2, "The commit ran before the push failed");
    buttonNamed("Publish Branch").click();
    await until(() => commitScript.pushes.length === 3, "the publishing push");
    check(commitScript.pushes[2]?.setUpstream === true, "Publishing sets the upstream");
    check(commitScript.commits.length === 2, "Publishing does not commit again");
    await until(() => report().includes("Pushed feature to origin."), `published: ${report()}`);

    // A rejected push names the remedy, and never offers a force.
    restoreWorkingTree();
    commitScript.pushResults = [{ kind: "rejected", reason: "non-fast-forward" }];
    await type("Commit message", "fix(desktop): pull first");
    await until(
      () => primary().getAttribute("aria-disabled") !== "true",
      "the action after a rejected push",
    );
    primary().click();
    await until(() => report().includes("Pull them, then push again."), `rejected: ${report()}`);
    check(report().includes("non-fast-forward"), "Git's own words are kept");
    check(!/force/i.test(container.textContent ?? ""), "Nothing offers a force push");

    // Nothing to commit is reported as an outcome, not as a failure to retry.
    restoreWorkingTree();
    commitScript.commitResults = [{ kind: "nothing_to_commit" }];
    commitScript.pushResults = [];
    await type("Commit message", "chore(desktop): nothing here");
    await until(
      () => primary().getAttribute("aria-disabled") !== "true",
      "the action before an empty commit",
    );
    primary().click();
    await until(() => report().includes("Nothing to commit."), `nothing to commit: ${report()}`);
    check(
      field("Commit message").value === "chore(desktop): nothing here",
      "A refused commit keeps the message",
    );

    // Creating a branch asks for a name, and a taken name keeps the typed message.
    commitScript.commitResults = [];
    commitScript.branchResults = [{ kind: "exists" }, { kind: "created" }];
    const menu = await openActionMenu();
    menuItem(menu, "Create Branch and Commit Changes").click();
    await until(
      () => container.querySelector('input[aria-label="New branch name"]') !== null,
      "the branch field",
    );
    check(commitScript.branches.length === 0, "Naming the branch is what creates it");
    await type("New branch name", "feature/commit-bar");
    await until(
      () =>
        buttonNamed("Create Branch and Commit Changes").getAttribute("aria-disabled") !== "true",
      "the branch confirmation",
    );
    buttonNamed("Create Branch and Commit Changes").click();
    await until(() => report().includes("already exists"), `branch exists: ${report()}`);
    check(commitScript.branches[0]?.checkout === true, "A created branch is checked out");
    check(
      field("Commit message").value === "chore(desktop): nothing here",
      "A refused branch keeps the typed message",
    );
    // The last action chosen is the one the primary button now offers.
    check(
      primary().textContent?.trim() === "Create Branch and Commit Changes",
      `Remembered action: ${String(primary().textContent)}`,
    );

    // A trust refusal is a plain sentence about trust, not a raw host error.
    commitScript.refuseCommit = true;
    commitScript.branchResults = [{ kind: "created" }];
    await type("New branch name", "feature/second");
    buttonNamed("Create Branch and Commit Changes").click();
    await until(() => report().includes("Trust this workspace"), `trust refusal: ${report()}`);

    // A pull request pushes its branch first, and a refused push never reaches GitHub.
    const pushed = commitScript.pushes.length;
    commitScript.pushResults = [{ kind: "rejected", reason: "non-fast-forward" }];
    const refusedMenu = await openActionMenu();
    menuItem(refusedMenu, "Create Pull Request").click();
    await until(
      () => commitScript.pushes.length === pushed + 1,
      "the push before the pull request",
    );
    await until(
      () => primary().getAttribute("aria-disabled") !== "true",
      "the refused pull request to settle",
    );
    check(report().includes("Pull them, then push again."), `refused push: ${report()}`);
    check(commitScript.pullRequests.length === 0, "A refused push never reaches GitHub");

    // Without the GitHub CLI, the pull request says what is missing.
    commitScript.pushResults = [];
    commitScript.pullRequestResults = [{ kind: "cli_missing" }];
    const prMenu = await openActionMenu();
    menuItem(prMenu, "Create Pull Request").click();
    await until(() => report().includes("GitHub CLI"), `pull request: ${report()}`);
    check(
      commitScript.pushes.length === pushed + 2,
      "The branch is pushed before the pull request",
    );
    check(commitScript.pullRequests.length === 1, "The pull request was attempted once");

    return "passed";
  } catch (error) {
    return error instanceof Error ? (error.stack ?? error.message) : String(error);
  } finally {
    root.unmount();
    container.remove();
  }
}

applyDisplayMode("light");
