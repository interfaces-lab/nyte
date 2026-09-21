import {
  BINARY_OID,
  PENDING_OID,
  pendingCommit,
  COMMITTED,
  COMMIT_OID,
  STAGED,
  WORKING,
} from "./changes-panel-preload.ts";
import { QueryClientProvider } from "@tanstack/react-query";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import type { ReactElement } from "react";
import { queryClient } from "../queries.ts";
import { ChangesPanel } from "./changes-panel.tsx";
import type { WorkbenchChangesScope } from "./controller.ts";
import "../theme/tokens.css";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
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

  const Panel = ({ scope }: { readonly scope: WorkbenchChangesScope }): ReactElement => {
    const [selectedPath, setSelectedPath] = useState<string>();
    const [revealRevision, setRevealRevision] = useState(0);
    const [scrollTop, setScrollTop] = useState(0);
    return (
      <QueryClientProvider client={queryClient}>
        <ChangesPanel
          sessionId={undefined}
          scope={scope}
          selectedPath={selectedPath}
          revealPathRevision={revealRevision}
          scrollTop={scrollTop}
          fileTreeVisible
          onScopeChange={() => undefined}
          onToggleFileTree={() => undefined}
          onSelectPath={setSelectedPath}
          onRevealPath={(path) => {
            setSelectedPath(path);
            setRevealRevision((revision) => revision + 1);
          }}
          onScrollTop={setScrollTop}
        />
      </QueryClientProvider>
    );
  };
  const render = (scope: WorkbenchChangesScope): void => {
    flushSync(() => root.render(<Panel scope={scope} />));
  };
  const stackHeaders = (): readonly HTMLElement[] =>
    Array.from(container.querySelectorAll("[data-change-path]")).filter(
      (element) => element instanceof HTMLElement,
    );
  const stackPaths = (): readonly string[] =>
    stackHeaders().map((header) => header.dataset.changePath ?? "");
  const treePaths = (): readonly string[] => {
    const host = container.querySelector("file-tree-container");
    if (!(host instanceof HTMLElement) || host.shadowRoot === null) return [];
    return Array.from(
      host.shadowRoot.querySelectorAll('[role="treeitem"][data-item-type="file"]'),
    ).map((item) => item.getAttribute("data-item-path") ?? "");
  };
  const header = (path: string): HTMLElement => {
    const found = stackHeaders().find((candidate) => candidate.dataset.changePath === path);
    if (found === undefined) throw new Error(`Missing diff header for ${path}`);
    return found;
  };
  const revertButton = (path: string): HTMLButtonElement => {
    const found = header(path).querySelector(`button[aria-label="Revert ${path}"]`);
    if (!(found instanceof HTMLButtonElement)) throw new Error(`Missing revert button for ${path}`);
    return found;
  };
  const checkStats = (path: string, label: string): void => {
    check(
      header(path).querySelector(`[aria-label="${label}"]`) !== null,
      `${path} does not show ${label}`,
    );
  };
  const checkTree = (expected: readonly string[]): void => {
    check(treePaths().join("|") === expected.join("|"), `Tree paths: ${treePaths().join("|")}`);
  };
  const checkStack = (expected: readonly string[]): void => {
    check(stackPaths().join("|") === expected.join("|"), `Stack paths: ${stackPaths().join("|")}`);
  };

  try {
    render({ kind: "uncommitted" });
    await until(() => stackPaths().length === 2, "the working-tree diff headers");
    await until(() => treePaths().length === 2, "the native file tree");
    await settle();
    checkTree([STAGED, WORKING]);
    checkStack([STAGED, WORKING]);
    checkStats(STAGED, "3 added, 0 removed");
    checkStats(WORKING, "1 added, 2 removed");
    const workingTreeRow = Array.from(
      container
        .querySelector("file-tree-container")
        ?.shadowRoot?.querySelectorAll('[role="treeitem"]') ?? [],
    ).find((row) => row.getAttribute("data-item-path") === WORKING);
    check(
      workingTreeRow?.textContent?.includes("+1 -2") === true,
      "Tree counts match the diff header",
    );
    check(!revertButton(STAGED).disabled, "A working-tree diff can be reverted");
    check(!revertButton(WORKING).disabled, "Every working-tree diff can be reverted");

    const fileTree = container.querySelector("file-tree-container");
    container.style.height = "120px";
    await settle();
    const workingRow = Array.from(
      fileTree?.shadowRoot?.querySelectorAll('[role="treeitem"]') ?? [],
    ).find((row) => row.getAttribute("data-item-path") === WORKING);
    check(workingRow instanceof HTMLElement, "The native tree has the working file");
    if (workingRow instanceof HTMLElement) workingRow.click();
    await until(() => {
      const scrollport = container.querySelector("[data-nyte-scrollport]");
      return scrollport instanceof HTMLElement && scrollport.scrollTop > 0;
    }, "the native tree selection to scroll CodeView");
    await settle();
    check(
      workingRow?.getAttribute("aria-selected") === "true",
      "The revealed file remains selected",
    );
    container.style.height = "600px";
    await settle();

    render({ kind: "commit", oid: COMMIT_OID });
    await until(
      () => stackPaths().join("|") === COMMITTED,
      "the commit diff header to replace the working tree",
    );
    await until(() => treePaths().join("|") === COMMITTED, "the commit file tree");
    await settle();
    checkTree([COMMITTED]);
    checkStack([COMMITTED]);
    checkStats(COMMITTED, "2 added, 1 removed");
    check(revertButton(COMMITTED).disabled, "A commit diff cannot be reverted");

    render({ kind: "commit", oid: PENDING_OID });
    await until(
      () => container.textContent?.includes("Loading changes") === true,
      "the commit loading state",
    );
    pendingCommit.reject(new Error("Commit diff unavailable"));
    await until(() => container.querySelector('[role="alert"]') !== null, "the commit read error");

    render({ kind: "commit", oid: BINARY_OID });
    await until(
      () =>
        Array.from(container.querySelectorAll("diffs-container")).some(
          (node) => node.shadowRoot?.textContent?.includes("Binary files a/image.png") === true,
        ),
      "the binary patch summary",
    );
    checkTree(["image.png"]);
    checkStack(["image.png"]);
    return "passed";
  } catch (error) {
    return error instanceof Error ? (error.stack ?? error.message) : String(error);
  } finally {
    root.unmount();
    queryClient.clear();
    container.remove();
  }
}
