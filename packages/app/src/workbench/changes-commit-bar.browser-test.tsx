import "../../test/window-bridge.ts";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { SdkError } from "@nyte-ai/sdk";
import type {
  GitApi,
  GitHubAccountState,
  GitHubApi,
  GitHubPullRequestInput,
  GitHubState,
  WorkspaceId,
} from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import { keys, queryClient } from "../queries.ts";
import { installConnection } from "../sdk.tsx";
import { scriptedConnection } from "../../test/scripted-connection.ts";
import { ChangesCommitBar } from "./changes-commit-bar.tsx";
import "../theme/tokens.stylex.ts";
import "../theme/global.css";

const WORKSPACE: WorkspaceId = asId("w1");

const REPOSITORY = {
  owner: "octo",
  name: "hello",
  remoteName: "origin",
  url: "https://github.com/octo/hello",
};

const ACCOUNT = { login: "octocat" };

const PULL_REQUEST = {
  number: 12,
  title: "Fix tab close",
  url: "https://github.com/octo/hello/pull/12",
  state: "OPEN",
  draft: false,
  headRefName: "fix/tab-close",
  baseRefName: "main",
  checks: [
    { name: "lint", state: "passed", url: "https://github.com/octo/hello/actions/runs/1" },
    { name: "test", state: "failed", url: "https://github.com/octo/hello/actions/runs/2" },
    { name: "e2e", state: "pending" },
  ],
} as const;

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const frame = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });

async function settle(): Promise<void> {
  for (let pass = 0; pass < 4; pass += 1) await frame();
  await new Promise<void>((resolve) => window.setTimeout(resolve, 30));
  await frame();
}

const refuse = async (): Promise<never> => {
  throw new SdkError("unavailable", "Not scripted.");
};

const created: GitHubPullRequestInput[] = [];

const opened: string[] = [];

const pushes: number[] = [];

const github: GitHubApi = {
  state: refuse,
  createPullRequest: async (input) => {
    created.push(input);

    return { kind: "created", url: "https://github.com/octo/hello/pull/13" };
  },
};

const git: GitApi = {
  status: refuse,
  watch: () => ({
    [Symbol.asyncIterator]: () => ({ next: refuse }),
  }),
  changes: refuse,
  watchChanges: () => ({
    [Symbol.asyncIterator]: () => ({ next: refuse }),
  }),
  patches: () => ({
    [Symbol.asyncIterator]: () => ({ next: refuse }),
  }),
  contents: refuse,
  log: refuse,
  refs: refuse,
  blame: refuse,
  stage: refuse,
  unstage: refuse,
  discard: refuse,
  commit: refuse,
  branch: refuse,
  push: async () => {
    pushes.push(Date.now());

    return { kind: "applied", revision: asId("r2") };
  },
};

function connect(): void {
  const { connection } = scriptedConnection({});

  installConnection({
    ...connection,
    workspace: (id) => ({
      ...connection.workspace(id),
      git: async () => ({ kind: "available", api: git }),
    }),
  });
}

function seed(
  api: GitHubApi | null,
  account: GitHubAccountState | null,
  state: GitHubState | undefined,
): void {
  queryClient.clear();
  queryClient.setQueryData(keys.host, {
    workspace: { id: WORKSPACE, path: "/srv/hello", name: "hello" },
  });
  queryClient.setQueryData([...keys.github, "capability", WORKSPACE], api);
  queryClient.setQueryData([...keys.github, "account"], account);

  if (state !== undefined) queryClient.setQueryData([...keys.github, "/srv/hello"], state);
}

function mount(root: Root): void {
  flushSync(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <ChangesCommitBar
          scope={{ kind: "uncommitted" }}
          branch={{
            kind: "attached",
            label: "fix/tab-close",
            upstream: "origin/fix/tab-close",
            ahead: 1,
            behind: 0,
          }}
          revision="r1"
          fileCount={3}
          onOpenLink={(url) => opened.push(url)}
        />
      </QueryClientProvider>,
    ),
  );
}

function primary(): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>('form button[type="submit"]');
  check(found !== null, "the primary action renders");

  return found;
}

async function menuItems(): Promise<readonly HTMLElement[]> {
  const trigger = document.querySelector<HTMLButtonElement>('[aria-label="More commit actions"]');
  check(trigger !== null, "the action menu trigger renders");

  if (trigger.getAttribute("aria-expanded") !== "true") trigger.click();
  await settle();
  const items = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  trigger.click();
  await settle();

  return items;
}

function disabled(button: HTMLButtonElement): boolean {
  return button.disabled || button.getAttribute("aria-disabled") === "true";
}

function typeMessage(text: string): void {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Commit message"]');
  check(input !== null, "the message field renders");
  input.focus();
  document.execCommand("insertText", false, text);
}

export async function run(): Promise<string> {
  applyDisplayMode("light");
  window.localStorage.setItem("nyte.desktop.changes-commit-action.v1", "pull-request");
  connect();
  const container = document.createElement("div");
  container.style.cssText = "width:380px";
  document.body.append(container);
  const root = createRoot(container);

  seed(null, null, undefined);
  mount(root);
  await settle();
  const offered = (await menuItems()).map((item) => item.textContent ?? "");
  check(
    !offered.some((label) => label.includes("Pull Request")),
    `a host without GitHub offers no pull request: ${offered.join(" | ")}`,
  );
  check(
    primary().textContent === "Commit and Push Changes",
    `the stored pull request action falls back: ${primary().textContent ?? ""}`,
  );
  root.unmount();

  const unavailable = { repository: REPOSITORY, pullRequest: { kind: "unavailable" } } as const;

  const blocked: readonly (readonly [GitHubAccountState, GitHubState, string])[] = [
    [{ kind: "cli_missing" }, unavailable, "Install the GitHub CLI (gh) to open pull requests"],
    [{ kind: "signed_out" }, unavailable, "Sign in to the GitHub CLI to open pull requests"],
    [
      { kind: "ready", account: ACCOUNT },
      { pullRequest: { kind: "none" } },
      "This repository has no GitHub remote",
    ],
  ];

  for (const [login, state, reason] of blocked) {
    const blockedRoot = createRoot(container);
    seed(github, login, state);
    mount(blockedRoot);
    await settle();
    check(primary().textContent === "Create Pull Request", "the stored action is offered");
    check(disabled(primary()), `${login.kind} disables the pull request`);
    check(primary().title === reason, `${login.kind} says why: ${primary().title}`);
    const said = document.querySelector("form p")?.textContent ?? "";
    check(said === reason, `${login.kind} says why under the bar: ${said}`);
    blockedRoot.unmount();
  }

  const readyRoot = createRoot(container);
  seed(
    github,
    { kind: "ready", account: ACCOUNT },
    { repository: REPOSITORY, pullRequest: { kind: "none" } },
  );
  mount(readyRoot);
  await settle();
  check(!disabled(primary()), "a ready repository can open a pull request");
  check(
    document.querySelector('section[aria-label="Pull request"]') === null,
    "no pull request shows before one exists",
  );
  typeMessage("Fix tab close");
  await settle();
  primary().click();
  await settle();
  await settle();
  check(pushes.length === 1, "the branch is pushed before the pull request opens");
  check(
    JSON.stringify(created) === JSON.stringify([{ title: "Fix tab close" }]),
    `the message titles the pull request: ${JSON.stringify(created)}`,
  );
  const status = document.querySelector('[role="status"]');
  check(
    status?.textContent?.includes("Pushed. Opened a pull request.") === true,
    `the outcome is reported: ${status?.textContent ?? ""}`,
  );
  const link = status?.querySelector("a");
  link?.click();
  check(
    opened.at(-1) === "https://github.com/octo/hello/pull/13",
    "the new pull request opens where the host opens links",
  );
  readyRoot.unmount();

  const pullRoot = createRoot(container);
  seed(
    github,
    { kind: "ready", account: ACCOUNT },
    { repository: REPOSITORY, pullRequest: { kind: "ready", pullRequest: PULL_REQUEST } },
  );
  mount(pullRoot);
  await settle();
  const section = document.querySelector<HTMLElement>('section[aria-label="Pull request"]');
  check(section !== null, "the branch's pull request shows");
  check(
    section.textContent?.includes("#12 Fix tab close") === true &&
      section.textContent.includes("Open"),
    `it names the pull request and its state: ${section.textContent ?? ""}`,
  );

  const summary = [...section.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("1 failing, 1 pending, 1 passed"),
  );

  check(
    summary !== undefined,
    `the checks are summed up failing first: ${section.textContent ?? ""}`,
  );
  check(section.querySelector('ul[aria-label="Checks"]') === null, "the checks start folded");
  summary.click();
  await settle();
  const checks = [...section.querySelectorAll('ul[aria-label="Checks"] li')];
  check(checks.length === 3, `every check is listed: ${String(checks.length)}`);
  checks[1]?.querySelector("a")?.click();
  check(
    opened.at(-1) === "https://github.com/octo/hello/actions/runs/2",
    "a check opens its own page",
  );
  section.querySelector("a")?.click();
  check(opened.at(-1) === PULL_REQUEST.url, "the title opens the pull request");
  pullRoot.unmount();

  return "passed";
}
