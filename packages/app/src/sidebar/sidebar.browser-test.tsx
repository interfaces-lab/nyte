import "../../test/window-bridge.ts";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterContextProvider } from "@tanstack/react-router";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Execution, SessionInfo, WorkspaceInfo } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { PaneControllerProvider } from "../panes/pane-context.tsx";
import { activePane } from "../panes/pane-layout.ts";
import { SessionDndProvider } from "../panes/session-dnd.tsx";
import { queryClient } from "../data/query-client.ts";
import { preferences } from "../preferences/index.ts";
import { windowTabs } from "../tabs/window-tabs.ts";
import { createAppRouter } from "../shell/routes.tsx";
import { installConnection } from "../data/connection.ts";
import "../theme/tokens.stylex.ts";
import { scriptedConnection, viewStream } from "../../test/scripted-connection.ts";
import { COMPLETED, sessionRow } from "../../test/view-fixtures.ts";
import { Sidebar } from "./sidebar.tsx";

const STORED = "nyte.desktop.sidebar.v3";

const live: Execution = {
  kind: "live",
  run: {
    id: asId<"run">("run"),
    head: asId<"head">("main"),
    startedAt: 1,
    attempt: 1,
    origin: { kind: "input", message: asId<"message">("m") },
  },
  phase: "responding",
  stopping: false,
};

function folder(id: string): WorkspaceInfo {
  return {
    id: asId<"workspace">(id),
    target: { kind: "local", path: `/work/${id}` },
    identity: asId("identity"),
    availability: { kind: "available" },
    projectResources: null,
    trusted: true,
    projectSources: [],
    addedBy: asId("tester"),
    sessions: 0,
    writers: [],
    isolation: null,
  };
}

function chat(
  name: string,
  workspace: string,
  createdAt: number,
  change: Partial<SessionInfo> = {},
) {
  return sessionRow(name, { workspace: asId<"workspace">(workspace), createdAt, ...change });
}

function unreadChat(unread: boolean): SessionInfo {
  return chat("Unread answer", "alpha", 80, {
    heads: [
      {
        name: asId<"head">("main"),
        tip: { kind: "commit", id: asId<"commit">("tip-1") },
        stack: null,
        execution: COMPLETED,
        unread,
        background: { working: 0, waiting: 0 },
      },
    ],
  });
}

function directory(unread: boolean): readonly SessionInfo[] {
  return [
    chat("Pinned plan", "alpha", 100, { pinned: true }),
    sessionRow("Working chat", { workspace: asId<"workspace">("alpha"), createdAt: 90 }, live),
    unreadChat(unread),
    chat("Quiet chat", "alpha", 70),
    ...Array.from({ length: 10 }, (_, index) =>
      chat(`Filler ${String(index + 1)}`, "beta", 60 - index),
    ),
  ];
}

const sessions = viewStream(directory(true));

const seen: string[] = [];

const updates: string[] = [];

const scripted = scriptedConnection({
  sessions,
  workspaces: [folder("alpha"), folder("beta"), folder("empty")],
  session: (id) => ({
    head: (name) => ({
      ...scripted.connection.session(id),
      name,
      see: async (commit) => {
        seen.push(`${id}:${name}:${commit}`);
      },
    }),
    update: async (patch) => {
      updates.push(`${id}:${JSON.stringify(patch)}`);

      return { kind: "updated" };
    },
  }),
});

installConnection(scripted.connection, scripted.live);

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function painted(): Promise<void> {
  return new Promise((resolve) =>
    window.requestAnimationFrame(() => window.setTimeout(() => resolve(), 0)),
  );
}

async function until(predicate: () => boolean, what: string): Promise<void> {
  const deadline = performance.now() + 10_000;

  while (!predicate()) {
    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await painted();
  }
}

function find(
  selector: string,
  text: string,
  root: ParentNode = document,
): HTMLElement | undefined {
  return [...root.querySelectorAll<HTMLElement>(selector)].find(
    (element) => element.textContent?.trim() === text && element.checkVisibility(),
  );
}

function get(selector: string, text: string, root: ParentNode = document): HTMLElement {
  const found = find(selector, text, root);

  if (found === undefined) throw new Error(`Missing ${selector} "${text}"`);

  return found;
}

function primary(name: string): HTMLElement {
  const label = get('[data-slot="row-label"]', name);
  const primary = label.closest<HTMLElement>('[data-slot="row-primary"]');

  if (primary === null) throw new Error(`Missing the row for ${name}`);

  return primary;
}

function press(target: Element, key: string): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

function menuItem(text: string): HTMLElement | undefined {
  return find('[role="menuitem"], [role="menuitemcheckbox"]', text);
}

async function contextMenu(target: HTMLElement): Promise<void> {
  const box = target.getBoundingClientRect();
  target.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: box.left + 4,
      clientY: box.top + 4,
    }),
  );
  await until(() => document.querySelector('[role="menu"]') !== null, "the context menu");
}

async function closeMenus(): Promise<void> {
  press(document.activeElement ?? document.body, "Escape");
  await until(() => document.querySelector('[role="menu"]') === null, "the menu to close");
}

function setValue(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const StoredSidebar = Type.Object({
  view: Type.Object({ show: Type.Array(Type.String()) }),
  folded: Type.Array(Type.Union([Type.String(), Type.Null()])),
  revealed: Type.Optional(Type.Record(Type.String(), Type.Number())),
});

function stored() {
  const parsed: unknown = JSON.parse(localStorage.getItem(STORED) ?? "{}");

  return Value.Parse(StoredSidebar, parsed);
}

// The window's own panes, so the window sees what the sidebar opens, as in the app.
const panes = windowTabs.controller();

function label(name: string): HTMLElement | undefined {
  return find('[data-slot="row-label"]', name);
}

function row(name: string): HTMLElement {
  const found = primary(name).closest<HTMLElement>('[data-slot="row"]');

  if (found === null) throw new Error(`Missing the row around ${name}`);

  return found;
}

async function storedViewAndFoldsAreShown(): Promise<void> {
  check(find("span", "Workspaces") !== undefined, "the stored grouping lists workspaces");
  check(primary("beta").getAttribute("aria-expanded") === "false", "beta stays folded");
}

async function openChatStaysUnderItsFoldedWorkspace(): Promise<void> {
  check(label("Filler 8") !== undefined, "the open chat stays listed");
  check(label("Filler 1") === undefined, "its siblings fold away");
}

async function pinnedChatsLeaveTheirWorkspace(): Promise<void> {
  const pinned = document.querySelector('section[aria-label="Pinned"]');

  if (pinned === null) throw new Error("Missing the Pinned section");
  check(find('[data-slot="row-label"]', "Pinned plan", pinned) !== undefined, "Pinned lists it");

  const listed = [...document.querySelectorAll('[data-slot="row-label"]')].filter(
    (element) => element.textContent === "Pinned plan",
  );

  check(listed.length === 1, "the pinned chat leaves its workspace");
}

async function emptyWorkspaceSaysNoChatsYet(): Promise<void> {
  check(find("div", "No chats yet") !== undefined, "an empty workspace says No chats yet");
}

async function arrowKeysMoveFocusAndFold(): Promise<void> {
  primary("Working chat").focus();
  press(primary("Working chat"), "ArrowDown");
  check(document.activeElement === primary("Unread answer"), "Down focuses the next chat");
  press(primary("Unread answer"), "ArrowLeft");
  check(document.activeElement === primary("alpha"), "Left goes from a chat to its header");
  press(primary("alpha"), "ArrowLeft");
  await until(() => primary("alpha").getAttribute("aria-expanded") === "false", "alpha to fold");
  check(label("Quiet chat") === undefined, "folding hides alpha's chats");
  press(primary("alpha"), "ArrowRight");
  await until(() => primary("alpha").getAttribute("aria-expanded") === "true", "alpha to unfold");
  press(primary("alpha"), "ArrowRight");
  check(document.activeElement === primary("Working chat"), "Right steps into an open header");
  press(primary("Working chat"), "End");
  check(document.activeElement === primary("empty"), "End focuses the last control");
  press(primary("empty"), "Home");
  check(document.activeElement === primary("Pinned plan"), "Home focuses the first control");
  primary("Filler 8").focus();
  press(primary("Filler 8"), "ArrowLeft");
  check(document.activeElement === primary("beta"), "Left goes from the kept chat to its header");
  const selection = activePane(panes.getSnapshot().layout).selection;

  check(
    selection.kind === "session" && selection.sessionId === asId<"session">("Filler 8"),
    "moving focus opens nothing",
  );
}

async function unfoldingIsStoredAndKeepsTheOpenChat(): Promise<void> {
  primary("beta").click();
  await until(() => label("Filler 5") !== undefined, "beta to unfold");
  check(label("Filler 8") !== undefined, "the open chat past the fold stays");
  check(label("Filler 9") === undefined, "the rows after it stay folded");
  check(stored().folded.length === 0, "unfolding is stored");
  get("button", "Show 2 More").click();
  await until(() => label("Filler 10") !== undefined, "Show More to reveal the rest");
  check(
    stored().revealed?.["local:beta"] === 11,
    "8 rows past the 3 the open chat raised are stored",
  );
}

async function hoverButtonsSitBesideTheAge(): Promise<void> {
  primary("Quiet chat").focus();
  await painted();
  const quiet = row("Quiet chat");
  const pin = quiet.querySelector<HTMLElement>('button[aria-label="Pin Quiet chat"]');
  const age = quiet.querySelector<HTMLElement>('[data-slot="row-meta"]');
  const actions = quiet.querySelector<HTMLElement>('[data-slot="row-actions"]');

  if (pin === null || age === null || actions === null)
    throw new Error("Missing the hover buttons or the age");
  const box = pin.getBoundingClientRect();
  check(box.width === 24 && box.height === 24, `pin is ${String(box.width)} px, not 24`);
  check(age.checkVisibility() && age.getBoundingClientRect().width > 0, "the age stays visible");

  check(
    actions.getBoundingClientRect().right <= age.getBoundingClientRect().left,
    "the hover buttons sit beside the age",
  );

  check(getComputedStyle(quiet).paddingInlineStart === "6px", "rows are padded 6 px");
  check(getComputedStyle(quiet.parentElement ?? quiet).rowGap === "2px", "rows are 2 px apart");
}

async function markAsReadSeesTheTip(): Promise<void> {
  await contextMenu(primary("Unread answer"));
  menuItem("Mark as Read")?.click();
  await until(() => seen.length === 1, "the row's read mark");
  await closeMenus();
  await contextMenu(primary("alpha"));
  menuItem("Mark All as Read")?.click();
  await until(() => seen.length === 2, "the workspace's read mark");
  check(
    seen.every((mark) => mark === "Unread answer:main:tip-1"),
    `saw ${seen.join(", ")}`,
  );
  await closeMenus();
  sessions.push(directory(false));
  await until(
    () => primary("Unread answer").querySelector('[aria-label="Unread"]') === null,
    "the unread mark to clear",
  );
  await contextMenu(primary("alpha"));
  check(menuItem("Mark All as Read") === undefined, "nothing is left to mark read");
  await closeMenus();
}

async function startRename(name: string): Promise<HTMLInputElement> {
  primary(name).dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  const selector = `input[aria-label="Rename ${name}"]`;
  await until(() => document.querySelector(selector) !== null, "the rename field");
  const field = document.querySelector<HTMLInputElement>(selector);

  if (field === null) throw new Error("Missing the rename field");

  return field;
}

async function doubleClickRenames(): Promise<void> {
  const field = await startRename("Quiet chat");
  check(document.activeElement === field, "the rename field takes focus");

  check(
    field.selectionStart === 0 && field.selectionEnd === "Quiet chat".length,
    "its text is selected",
  );

  setValue(field, "Something else");
  press(field, "Escape");
  await until(() => label("Quiet chat") !== undefined, "Escape to cancel");
  check(!updates.some((update) => update.includes("Something else")), "Escape saves nothing");
  const again = await startRename("Quiet chat");
  setValue(again, "Renamed chat");
  press(again, "Enter");
  await until(() => updates.includes('Quiet chat:{"name":"Renamed chat"}'), "the rename to save");
}

function archiveWorkingChat(): void {
  document.querySelector<HTMLElement>('button[aria-label="Archive Working chat"]')?.click();
}

async function archivingAWorkingChatAsksFirst(): Promise<void> {
  archiveWorkingChat();
  await until(() => find("h2", "Archive Working Chat") !== undefined, "the archive confirmation");
  get("button", "Cancel").click();
  await until(() => find("h2", "Archive Working Chat") === undefined, "the dialog to close");
  check(!updates.some((update) => update.startsWith("Working chat:")), "Cancel archives nothing");
  check(label("Working chat") !== undefined, "the working chat stays listed");
  archiveWorkingChat();
  await until(() => find("h2", "Archive Working Chat") !== undefined, "the archive confirmation");
  get("button", "Archive Chat").click();
  await until(() => updates.includes('Working chat:{"archived":true}'), "the archive");
}

async function showTogglesChangeTheRow(): Promise<void> {
  document.querySelector<HTMLElement>('button[aria-label="Customize sidebar"]')?.click();
  await until(() => menuItem("Show") !== undefined, "the Customize sidebar menu");
  check(menuItem("PR") === undefined, "no PR filter without PR data");
  menuItem("Show")?.click();
  await until(() => menuItem("Updated") !== undefined, "the Show menu");
  menuItem("Updated")?.click();
  await until(() => row("Filler 8").querySelector('[data-slot="row-meta"]') === null, "no age");
  check(stored().view.show.length === 0, "Show is stored");
}

async function openingAnUnreadInboxChatKeepsItThereUntilLeft(): Promise<void> {
  sessions.push(directory(true));
  preferences.sidebarView.set({ ...preferences.sidebarView.get(), grouping: "inbox" });
  await until(() => find("button", "Done11") !== undefined, "the Inbox and its folded Done shelf");
  check(label("Unread answer") !== undefined, "an unread chat is in the Inbox");
  panes.selectSession(asId<"session">("Unread answer"));
  await painted();
  check(label("Unread answer") !== undefined, "opening an unread chat keeps it in the Inbox");
  sessions.push(directory(false));
  await until(
    () => primary("Unread answer").querySelector('[aria-label="Unread"]') === null,
    "the read mark to land",
  );
  check(
    label("Unread answer") !== undefined,
    "reading it keeps it in the Inbox while it stays open",
  );
  panes.selectSession(asId<"session">("Quiet chat"));
  await until(() => label("Unread answer") === undefined, "leaving it to move it to Done");
}

const STEPS = {
  storedViewAndFoldsAreShown,
  openChatStaysUnderItsFoldedWorkspace,
  pinnedChatsLeaveTheirWorkspace,
  emptyWorkspaceSaysNoChatsYet,
  arrowKeysMoveFocusAndFold,
  unfoldingIsStoredAndKeepsTheOpenChat,
  hoverButtonsSitBesideTheAge,
  markAsReadSeesTheTip,
  doubleClickRenames,
  archivingAWorkingChatAsksFirst,
  showTogglesChangeTheRow,
  openingAnUnreadInboxChatKeepsItThereUntilLeft,
};

export async function run(): Promise<string> {
  queryClient.clear();
  const container = document.createElement("div");
  container.style.cssText = "display:flex;width:256px;height:900px";
  document.body.append(container);
  panes.selectSession(asId<"session">("Filler 8"));
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: ["/"] }) });
  const root = createRoot(container);

  flushSync(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <RouterContextProvider router={router}>
          <TooltipProvider delay={0} closeDelay={0} timeout={0}>
            <PaneControllerProvider>
              <SessionDndProvider>
                <Sidebar />
              </SessionDndProvider>
            </PaneControllerProvider>
          </TooltipProvider>
        </RouterContextProvider>
      </QueryClientProvider>,
    ),
  );

  try {
    await until(() => label("Quiet chat") !== undefined, "the chats");

    for (const step of Object.values(STEPS)) await step();

    return "passed";
  } finally {
    flushSync(() => root.unmount());
    container.remove();
    queryClient.clear();
  }
}
