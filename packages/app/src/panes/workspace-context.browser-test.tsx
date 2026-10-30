import "../../test/window-bridge.ts";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { SdkError } from "@nyte-ai/sdk";
import type { FilesApi, GitApi, GitStatus, WorkspaceInfo } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { useMentionFiles } from "../data/files.ts";
import { keys, queryClient } from "../data/query-client.ts";
import { installConnection } from "../data/connection.ts";
import { useVcsLog } from "../data/vcs.ts";
import { WorkspaceContext } from "./workspace-context.tsx";
import "../theme/global.css";
import "../theme/tokens.stylex.ts";
import { scriptedConnection, viewStream } from "../../test/scripted-connection.ts";
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

const revision = asId<"git-revision">("r1");

const onMain: GitStatus = {
  kind: "repository",
  root: "/u/dev/nyte",
  head: asId<"git-commit">("4f2a9c1d0e"),
  branch: "main",
  upstream: null,
  revision,
  staged: [],
  unstaged: [],
  untracked: [],
  conflicts: [],
};

const topicRevision = asId<"git-revision">("r2");

const onTopic: GitStatus = {
  ...onMain,
  head: asId<"git-commit">("7b3e5d2a1f"),
  branch: "topic",
  revision: topicRevision,
};

const status = viewStream(onMain);

const checkedOut: string[] = [];

const checkedOutBranch = (): string => checkedOut.at(-1) ?? "main";

const refuse = async (): Promise<never> => {
  throw new SdkError("unavailable", "Not scripted.");
};

const git: Partial<GitApi> = {
  watch: () => status.watch(),
  log: async () => ({
    items: [
      {
        id: asId<"git-commit">(checkedOutBranch()),
        subject: `${checkedOutBranch()} tip`,
        author: "tester",
        committedAt: 0,
        parents: [],
      },
    ],
    next: null,
  }),
  refs: async () => ({
    current: "main",
    branches: ["main", "topic", "release"].map((name) => ({
      name,
      commit: asId<"git-commit">(name),
      upstream: null,
    })),
    remotes: [],
  }),
  checkout: async ({ name }) => {
    checkedOut.push(name);
    status.push(onTopic);

    return { kind: "applied", revision: topicRevision };
  },
};

const files: FilesApi = {
  read: refuse,
  bytes: refuse,
  stat: refuse,
  write: refuse,
  remove: refuse,
  batch: () => {
    throw new SdkError("unavailable", "Not scripted.");
  },
  format: refuse,
  scan: async function* () {
    yield {
      kind: "entries",
      entries: [{ path: `${checkedOutBranch()}.ts`, kind: "file", size: 1, version: null }],
    };
    yield { kind: "complete" };
  },
  find: refuse,
  search: async function* () {
    yield { kind: "complete" };
  },
  watch: async function* () {
    yield* [];
    await new Promise<never>(() => undefined);
  },
  upload: refuse,
};

/** What the Commits menu lists while it is open. */
function History(): ReactElement {
  const history = useVcsLog({ limit: 50 }, true);

  return (
    <output data-history>{history.data?.items.map((commit) => commit.subject).join("|")}</output>
  );
}

/** What a mounted file list, the explorer's or the composer's, holds. */
function FileList(): ReactElement {
  const listed = useMentionFiles(true);

  return <output data-files>{listed.data?.map((file) => file.displayPath).join("|")}</output>;
}

function shown(selector: string): string {
  return document.querySelector(selector)?.textContent ?? "";
}

function options(): readonly string[] {
  return Array.from(document.querySelectorAll("[role='option']"), (row) =>
    (row.textContent ?? "").trim(),
  );
}

function type(field: HTMLInputElement, text: string): void {
  field.focus();
  field.select();
  document.execCommand("insertText", false, text);
}

async function checkBranches(): Promise<string> {
  queryClient.clear();
  queryClient.setQueryData(keys.host, {
    workspace: { id: asId<"workspace">("nyte"), path: "/u/dev/nyte", name: "nyte" },
  });
  const { connection } = scriptedConnection({ workspaces, sessions, git });

  installConnection({
    ...connection,
    workspace: (id) => ({
      ...connection.workspace(id),
      files: async () => ({ kind: "available", api: files }),
    }),
  });
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;left:0;bottom:0;padding:16px";
  document.body.append(container);
  const root = createRoot(container);

  const render = (commits: boolean): void =>
    flushSync(() =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider delay={0} closeDelay={0} timeout={0}>
            <WorkspaceContext active />
            {commits && <History />}
            <FileList />
          </TooltipProvider>
        </QueryClientProvider>,
      ),
    );

  render(true);

  try {
    await until(() => shown("[data-history]") === "main tip", "main's history");
    await until(() => shown("[data-files]") === "main.ts", "main's files");
    render(false);

    const trigger = await until(
      () =>
        Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
          (button) => button.textContent === "main",
        ),
      "the branch segment reading main",
    );

    trigger.click();

    const search = await until(
      () => document.querySelector<HTMLInputElement>("input[aria-label='Search branches']"),
      "the branch search",
    );

    await until(
      () => options().join("|") === "main|topic|release|Create Branch…",
      `every branch and Create Branch…, listed: ${options().join("|")}`,
    );

    type(search, "zz");
    await until(
      () => document.body.textContent?.includes("No branches found"),
      "No branches found",
    );
    expectRule(
      options().join("|") === "Create Branch…",
      `a search with no match offers only Create Branch…: ${options().join("|")}`,
    );

    type(search, "top");
    await until(() => options().join("|") === "topic|Create Branch…", "topic alone");
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await until(() => checkedOut.length > 0, "a checkout");
    expectRule(checkedOut.join("|") === "topic", `checked out ${checkedOut.join("|")}`);

    await until(() => shown("[data-files]") === "topic.ts", "the mounted file list to read topic");
    render(true);
    await until(() => shown("[data-history]") === "topic tip", "reopened history to read topic");

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

  return Promise.race([
    checkMenu().then((menu) => (menu === "passed" ? checkBranches() : menu)),
    watchdog,
  ]);
}
