/**
 * The workspace menu over a store like a long-lived desktop's: one folder
 * registered under several ids, folders that are gone, a session worktree,
 * two folders with the same name. It lists each folder once, most recently
 * used first, and Open Folder… stays in view however little room the menu
 * gets.
 */
import "../../test/window-bridge.ts";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { WorkspaceInfo } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { keys, queryClient } from "../queries.ts";
import { installConnection } from "../sdk.tsx";
import { WorkspaceContext } from "./workspace-context.tsx";
import "../theme/global.css";
import "../theme/tokens.stylex.ts";
import { scriptedConnection } from "../../test/scripted-connection.ts";
import { sessionRow } from "../../test/view-fixtures.ts";

function folder(
  id: string,
  path: string,
  change: Partial<Pick<WorkspaceInfo, "availability" | "isolation">> = {},
): WorkspaceInfo {
  return {
    id: asId<"workspace">(id),
    target: { kind: "local", path },
    identity: asId<"environment-identity">(id),
    availability: { kind: "available" },
    projectResources: null,
    trusted: true,
    projectSources: [],
    addedBy: asId<"principal">("tester"),
    sessions: 0,
    writers: [],
    isolation: null,
    ...change,
  };
}

const gone = { availability: { kind: "unavailable", reason: "unreachable" } } as const;

const workspaces = [
  folder("desktop", "/u/dev/nyte/packages/desktop"),
  folder("stale-nyte", "/u/dev/nyte", gone),
  folder("tmp", "/private/tmp/nyte-cwd-Oohl", gone),
  folder("docs", "/u/dev/nyte/packages/docs"),
  folder("legacy-nyte", "/u/dev/nyte"),
  folder("demo-tui", "/u/dev/nyte/packages/demo/tui"),
  folder("lazy", "/u/dev/lazy"),
  folder("tui", "/u/dev/nyte/packages/tui"),
  folder("home", "/u/home"),
  folder("nyte", "/u/dev/nyte"),
  folder("worktree", "/u/.nyte/worktrees/nyte-feature", {
    isolation: {
      kind: "worktree",
      source: asId<"workspace">("nyte"),
      session: asId<"session">("in-worktree"),
      branch: "feature",
      base: "0000000",
    },
  }),
];

const sessions = [
  sessionRow("in-worktree", { workspace: asId<"workspace">("worktree"), lastActivityAt: 90 }),
  sessionRow("in-legacy", { workspace: asId<"workspace">("legacy-nyte"), lastActivityAt: 10 }),
  sessionRow("in-tui", { workspace: asId<"workspace">("tui"), lastActivityAt: 80 }),
  sessionRow("in-demo-tui", { workspace: asId<"workspace">("demo-tui"), lastActivityAt: 70 }),
  sessionRow("in-lazy", { workspace: asId<"workspace">("lazy"), lastActivityAt: 60 }),
  sessionRow("in-docs", { workspace: asId<"workspace">("docs"), lastActivityAt: 40 }),
];

const failures: string[] = [];

function expectRule(passed: boolean, message: string): void {
  if (!passed) failures.push(message);
}

async function until<T>(read: () => T | null | undefined | false, what: string): Promise<T> {
  const deadline = performance.now() + 5_000;

  for (;;) {
    const value = read();

    if (value !== null && value !== undefined && value !== false) return value;

    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 10));
  }
}

function rows(menu: Element): readonly string[] {
  return Array.from(menu.querySelectorAll("[role='menuitemradio']"), (row) =>
    (row.textContent ?? "").trim(),
  );
}

async function checkMenu(): Promise<string> {
  queryClient.clear();
  queryClient.setQueryData(keys.host, { workspace: undefined });
  installConnection(scriptedConnection({ workspaces, sessions }).connection);
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;left:0;bottom:0;padding:16px";
  document.body.style.cssText = "margin:0";
  document.body.append(container);
  const root = createRoot(container);

  flushSync(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delay={0} closeDelay={0} timeout={0}>
          <WorkspaceContext active />
        </TooltipProvider>
      </QueryClientProvider>,
    ),
  );

  try {
    await until(() => queryClient.getQueryData(keys.workspaces), "the workspace list");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: ".", ctrlKey: true, bubbles: true }));

    const menu = await until(
      () =>
        document.querySelector("[role='menu']")?.textContent?.includes("docs") === true &&
        document.querySelector("[role='menu']"),
      "the workspace menu with its folders",
    );

    expectRule(
      rows(menu).join("|") === "Home|nyte|tuipackages|tuidemo|lazy|docs",
      `Recent Workspaces lists each available folder once, newest first: ${rows(menu).join("|")}`,
    );

    const open = Array.from(menu.querySelectorAll("[role='menuitem']")).find(
      (item) => item.textContent?.trim() === "Open Folder…",
    );

    const bounds = menu.getBoundingClientRect();

    expectRule(open !== undefined, "Open Folder… is in the menu");
    const openBottom = open?.getBoundingClientRect().bottom ?? Number.POSITIVE_INFINITY;

    expectRule(
      openBottom <= bounds.bottom && bounds.bottom <= window.innerHeight,
      `Open Folder… is visible without scrolling: its bottom ${String(openBottom)}, the menu's ${String(bounds.bottom)}, the window's ${String(window.innerHeight)}`,
    );

    const more = await until(
      () =>
        Array.from(menu.querySelectorAll<HTMLElement>("[role='menuitem']")).find(
          (item) => item.textContent?.trim() === "More Workspaces",
        ),
      "More Workspaces",
    );

    more.click();

    const submenu = await until(
      () => document.querySelectorAll("[role='menu']")[1],
      "the More Workspaces submenu",
    );

    expectRule(
      rows(submenu).join("|") === "desktop|home",
      `More Workspaces holds only the older folders: ${rows(submenu).join("|")}`,
    );

    return failures.length === 0 ? "passed" : failures.join("\n");
  } finally {
    flushSync(() => root.unmount());
    container.remove();
    queryClient.clear();
  }
}

export function run(): Promise<string> {
  const watchdog = new Promise<string>((resolve) =>
    window.setTimeout(() => resolve(`timed out\n${failures.join("\n")}`), 30_000),
  );

  return Promise.race([checkMenu(), watchdog]);
}
