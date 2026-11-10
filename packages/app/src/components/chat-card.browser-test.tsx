import "../../test/window-bridge.ts";
import { tabPanes } from "../../test/panes.ts";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { GitStatus, WorkspaceInfo } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import { SessionRow } from "../sidebar/sidebar-rows.tsx";
import { ChatCardGroup } from "./chat-card.tsx";
import { PaneControllerProvider } from "../panes/pane-context.tsx";
import type { PaneController } from "../panes/pane-controller.ts";
import { SessionDndProvider } from "../panes/session-dnd.tsx";
import { keys, queryClient } from "../data/query-client.ts";
import { WindowTabStrip } from "../tabs/window-tab-strip.tsx";
import "../theme/tokens.stylex.ts";
import "../theme/global.css";
import { installScripted, scriptedConnection } from "../../test/scripted-connection.ts";
import { sessionRow } from "../../test/view-fixtures.ts";

const FOLDER = asId<"workspace">("folder");

const PATH = "/Users/ada/Developer/nyte";

const folder: WorkspaceInfo = {
  id: FOLDER,
  target: { kind: "local", path: PATH },
  identity: asId("folder"),
  availability: { kind: "available" },
  projectResources: true,
  trusted: true,
  projectSources: [],
  addedBy: asId("local"),
  sessions: 1,
  writers: [],
  isolation: null,
};

const status: GitStatus = {
  kind: "repository",
  root: PATH,
  head: null,
  branch: "main",
  upstream: null,
  revision: asId<"git-revision">("r1"),
  staged: [],
  unstaged: [],
  untracked: [],
  conflicts: [],
};

const chat = sessionRow("chat", { name: "Fix the scroll restore", workspace: FOLDER });

installScripted(
  scriptedConnection({
    sessions: [chat],
    workspaces: [folder],
    git: {
      watch: async function* () {
        yield status;
        await new Promise<never>(() => undefined);
      },
    },
    workspaceGitHub: {
      repository: async () => ({
        owner: "nyte-ai",
        name: "nyte",
        remoteName: "origin",
        url: "https://github.com/nyte-ai/nyte",
      }),
    },
  }),
);

function Stage({ panes }: { readonly panes: PaneController }): ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <PaneControllerProvider controller={panes}>
        <SessionDndProvider>
          <ChatCardGroup placement="row">
            <div style={{ width: 240 }}>
              <SessionRow
                session={chat}
                selected={false}
                draggable
                unreachable={false}
                showUpdated={false}
              />
            </div>
          </ChatCardGroup>
        </SessionDndProvider>
      </PaneControllerProvider>
      <div style={{ display: "flex", width: 600, height: 40, marginTop: 40 }}>
        <WindowTabStrip
          tabs={[
            {
              id: "tab",
              title: chat.name ?? "",
              tooltip: chat.name ?? "",
              sessions: [chat.id],
              preview: false,
              chat: chat.id,
              glyph: undefined,
              split: undefined,
            },
          ]}
          activeTabId="tab"
          mac
          onActivate={() => undefined}
          onClose={() => undefined}
          onNewTab={() => undefined}
          onKeep={() => undefined}
          onOpenParent={() => undefined}
          onReorder={() => undefined}
          onCloseOthers={() => undefined}
          onCloseToRight={() => undefined}
          chat={{
            rename: () => undefined,
            pin: () => undefined,
            markRead: () => undefined,
            openBeside: () => undefined,
            archive: () => undefined,
            remove: () => undefined,
          }}
        />
      </div>
    </QueryClientProvider>
  );
}

async function until<T>(read: () => T | null | undefined, what: string): Promise<T> {
  const deadline = performance.now() + 5_000;

  for (;;) {
    const value = read();

    if (value !== null && value !== undefined) return value;

    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 10));
  }
}

function card(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[data-slot="preview-card-content"]:not([data-ending-style])',
  );
}

function hover(element: Element): void {
  element.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true, pointerType: "mouse" }));
  element.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
  element.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
}

function leave(element: Element): void {
  element.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true, pointerType: "mouse" }));
  element.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false }));
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function openCard(trigger: Element): Promise<HTMLElement> {
  const started = performance.now();
  hover(trigger);
  await new Promise<void>((resolve) => window.setTimeout(resolve, 150));
  check(card() === null, "The card opened before 250 ms");
  const opened = await until(card, "the chat card");
  check(performance.now() - started >= 240, "The card opened before 250 ms");

  return until(
    () => (opened.textContent.includes("nyte-ai/nyte") ? opened : null),
    "the repository line",
  );
}

function readCard(element: HTMLElement): string {
  return [...element.querySelectorAll("[data-slot='row-label'], [data-slot='row-description']")]
    .map((part) => part.textContent)
    .join(" | ");
}

export async function run(): Promise<string> {
  applyDisplayMode("light");
  queryClient.clear();
  queryClient.setQueryData(keys.host, { workspace: undefined });
  const container = document.createElement("div");
  container.style.padding = "40px";
  document.body.append(container);
  const root = createRoot(container);
  const panes = tabPanes();
  flushSync(() => root.render(<Stage panes={panes} />));

  try {
    const row = await until(
      () => container.querySelector("[data-slot='row']:has([aria-current], button)"),
      "the sidebar row",
    );

    const rowCard = await openCard(row);
    const expected = "nyte-ai/nyte | main · ~/Developer/nyte";
    check(readCard(rowCard) === expected, `The row card read ${readCard(rowCard)}`);
    check(rowCard.textContent.includes("Fix the scroll restore"), "The row card lacks the title");
    const rowBox = row.getBoundingClientRect();
    const rowCardBox = rowCard.getBoundingClientRect();
    check(rowCardBox.left >= rowBox.right, "The row card is not to the right of the row");
    check(Math.abs(rowCardBox.top - rowBox.top) <= 1, "The row card is not top-aligned");

    const folderLine = await until(
      () =>
        [...rowCard.querySelectorAll("button")].find((line) =>
          line.textContent.includes("~/Developer/nyte"),
        ),
      "the folder line",
    );

    folderLine.click();
    await until(
      () =>
        folderLine.closest("[data-slot='row']")?.querySelector("[role='status']")?.textContent ===
        "Copied"
          ? folderLine
          : null,
      "the copied folder",
    );
    check((await navigator.clipboard.readText()) === PATH, "The folder line copied the short path");

    leave(row);
    await until(() => (card() === null ? true : null), "the row card to close");

    const tab = await until(() => container.querySelector("[role='tab']"), "the tab");
    const tabCard = await openCard(tab);
    check(readCard(tabCard) === expected, `The tab card read ${readCard(tabCard)}`);
    check(tabCard.textContent.includes("⌘"), "The tab card lost the tab shortcut");
    const tabBox = tab.getBoundingClientRect();
    check(
      tabCard.getBoundingClientRect().top >= tabBox.bottom,
      "The tab card is not below the tab",
    );

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await until(() => (card() === null ? true : null), "Escape to close the tab card");

    return "passed";
  } finally {
    root.unmount();
    container.remove();
  }
}
