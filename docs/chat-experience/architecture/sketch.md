# Type sketch

The synthesized design's types and signatures, from the Sol candidate (base). Bodies are `not implemented`; the design and its grafts are in [rationale.md](rationale.md). These were typechecked against the app's installed packages when written.

## `chats/index.ts`

```ts
import type { RunId, SessionId, WorkspaceId } from "@nyte-ai/sdk/client";

/** Unknown is not Home. Failed workspace resolution must never close the host folder. */
export type ChatLocation =
  | { readonly kind: "loading" }
  | { readonly kind: "home"; readonly machine: Machine }
  | { readonly kind: "unavailable"; readonly workspace: WorkspaceId; readonly reason: string }
  | {
      readonly kind: "folder";
      readonly workspace: WorkspaceId;
      /** Actual execution cwd. Never the worktree's source folder. */
      readonly path: string;
      readonly name: string;
      readonly displayPath: string;
      readonly machine: Machine;
      readonly repository: Repository | null;
      readonly worktree: Worktree | null;
    };

/** Describes the connected host. A web renderer can be talking to a local host. */
export type Machine =
  | { readonly kind: "local"; readonly label: "Local" }
  | { readonly kind: "remote"; readonly label: string };

export interface Repository {
  readonly name: string;
  /** null includes detached HEAD. No branch from a different workspace is substituted. */
  readonly branch: string | null;
}

export interface Worktree {
  readonly name: string;
  readonly source: WorkspaceId;
}

export type RunOutcome =
  | { readonly kind: "completed"; readonly run: RunId }
  | { readonly kind: "stopped"; readonly run: RunId }
  | { readonly kind: "failed"; readonly run: RunId; readonly message: string };

/** Own execution capability. A descendant working does not manufacture a local Stop target. */
export type OwnRun =
  | { readonly kind: "idle"; readonly last: RunOutcome | null }
  | { readonly kind: "working"; readonly run: RunId; readonly stopping: boolean }
  | { readonly kind: "waiting-for-approval"; readonly run: RunId }
  | { readonly kind: "waiting"; readonly run: RunId; readonly on: "child" | "job" | "timer" }
  | { readonly kind: "retrying"; readonly run: RunId; readonly until: number; readonly reason: string };

/** All run-status UI, including spoken labels, accepts this instead of interpreting execution. */
export interface RunStatus {
  readonly kind:
    | "idle"
    | "working"
    | "waiting-for-approval"
    | "failed"
    | "completed"
    | "stopped"
    | "subagent-still-working";
  readonly label: string;
  readonly glyph: "none" | "working" | "attention" | "failed" | "completed" | "stopped";
}

export interface ChatRun {
  readonly self: OwnRun;
  readonly status: RunStatus;
  /** Includes waiting/retrying descendants. Computed once from the selected records, not raw lists. */
  readonly activeDescendants: readonly SessionId[];
}

export interface Chat {
  readonly id: SessionId;
  readonly parent: SessionId | null;
  /** The only fallback owner: root = New chat; unnamed child = Subagent. */
  readonly title: string;
  readonly location: ChatLocation;
  readonly run: ChatRun;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type ChatResult =
  | { readonly kind: "loading" }
  | { readonly kind: "missing" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "ready"; readonly chat: Chat };

/** Connection scoped. No methods here can place a chat, focus an editor or advance a read mark. */
export interface Chats {
  readonly get: (id: SessionId) => ChatResult;
  readonly all: () => readonly Chat[];
  /** A chat subscription resolves its direct-info/location dependencies; null observes the directory only. */
  readonly subscribe: (chat: SessionId | null, notice: () => void) => () => void;
}
```

## `chats/internal/feed.ts`

```ts
import type {
  CommitId,
  Execution,
  GitHubRepository,
  GitStatus,
  SessionId,
  SessionInfo,
  SessionView,
  WorkspaceId,
  WorkspaceInfo,
} from "@nyte-ai/sdk/client";
import { executionMark, mainHead } from "@nyte-ai/plugin/client/presentation";
import type { Chat, ChatLocation, ChatRun, Machine, OwnRun } from "../index.ts";
import type { ReadFacts } from "../runtime.ts";

/** References to existing SDK watch snapshots. No second mutable cache of wire objects. */
export interface SourceSnapshot {
  readonly listed: readonly SessionInfo[] | undefined;
  readonly info: ReadonlyMap<SessionId, SessionInfo | null>;
  /** Only currently subscribed views with a first value, before text pacing. Cached inactive views are absent. */
  readonly liveViews: ReadonlyMap<SessionId, SessionView>;
  readonly workspaces: readonly WorkspaceInfo[] | undefined;
  readonly locations: ReadonlyMap<WorkspaceId, WorkspaceMetadata>;
  readonly machine: Machine;
}

export interface WorkspaceMetadata {
  readonly git: GitStatus | undefined;
  readonly repository: GitHubRepository | null | undefined;
  readonly hostHome: string | undefined;
}

/** The one selected-head rule, including mainHead's existing main-else-first fallback. */
export interface HeadFacts {
  readonly execution: Execution | undefined;
  readonly tip: CommitId | null;
  readonly unread: boolean;
  readonly baseline: ReadFacts["baseline"];
}

/** One normalized index per connection. Child lookup and workspace fan-out do not need later caches. */
export interface DirectorySnapshot {
  readonly byId: ReadonlyMap<SessionId, Chat>;
  readonly byParent: ReadonlyMap<SessionId, readonly SessionId[]>;
  readonly byWorkspace: ReadonlyMap<WorkspaceId, readonly SessionId[]>;
  readonly heads: ReadonlyMap<SessionId, HeadFacts>;
}

export function selectHead(info: SessionInfo, view: SessionView | undefined): HeadFacts {
  // TODO const listed = mainHead(info); const drawn = view === undefined ? undefined : mainHead(view).
  // TODO A ready subscribed view wins as a unit: execution, unread and tip. Never mix heads or streams.
  // TODO baseline is loading without D1 view data, known(null) before the first read.
  // TODO Release removes view priority immediately. No arrival-time ordering or cross-stream clocks.
  throw new Error("not implemented");
}

/** Refines the cross-client mark instead of copying its execution switch into the app. */
export function projectOwnRun(execution: Execution | undefined): OwnRun {
  // TODO Begin with executionMark(execution), then narrow execution for terminal outcome and retry detail.
  // TODO Waiting on part retains the established approval/question meaning. Stopped is never failed.
  throw new Error("not implemented");
}

export function projectRun(self: OwnRun, descendants: readonly SessionId[]): ChatRun {
  // TODO Own waiting-for-approval wins, then own working/waiting/retrying.
  // TODO Idle own execution plus active descendants => subagent-still-working.
  // TODO Otherwise retain own failed/completed/stopped/never-run outcome and shared label/glyph.
  // TODO Preserve self.last even when descendant activity changes the headline status.
  throw new Error("not implemented");
}

export function projectDirectory(sources: SourceSnapshot): DirectorySnapshot {
  // TODO Identity comes from all-list, with direct info only for IDs not listed yet.
  // TODO Select every head once, build parent and workspace indices, then derive ancestor activity once.
  // TODO Status, tab summaries and tray rows all read those selected records.
  // TODO Pass selected-head read facts to window. No unread-completion or visibility policy lives in chats.
  throw new Error("not implemented");
}

export function resolveLocation(info: SessionInfo, sources: SourceSnapshot): ChatLocation {
  // TODO Keep unknown workspace list distinct from a loaded missing workspace/Home.
  // TODO Retain unavailable targets instead of silently treating them as Home.
  // TODO Local path is the chat workspace target; isolation.source is group identity only.
  // TODO Use that workspace's git branch, then isolation.branch if git not yet known.
  // TODO Detached HEAD stays branch:null; do not substitute an isolation branch for a known detached head.
  // TODO GitHub owner/name is optional enrichment; repository falls back to git root folder name.
  // TODO Shorten only an actual hostHome prefix. Never regex-match the renderer's guessed home path.
  throw new Error("not implemented");
}
```

## `chats/runtime.ts`

```ts
import type { CommitId, Connection, RunId, SessionId } from "@nyte-ai/sdk/client";
import type { Chat, Chats, Machine } from "./index.ts";

/** Read facts have one selected-head source. Only window owns the UI's unread/visit policy. */
export interface ReadFacts {
  readonly tip: CommitId | null;
  readonly baseline:
    | { readonly kind: "loading" }
    | { readonly kind: "known"; readonly through: number | null };
  readonly unread: boolean;
}

/** Privileged capabilities for window/runtime only. UI imports chats/index instead. */
export interface ChatSource {
  readonly chats: Chats;
  readonly resolve: (id: SessionId) => Promise<Chat | null>;
  /** Uses the existing pager when the initial tail cannot locate the first unread reply. */
  readonly ensureHistoryThrough: (id: SessionId, through: number) => Promise<void>;
  readonly see: (id: SessionId, tip: CommitId) => Promise<void>;
  readonly markRead: (ids: readonly SessionId[]) => Promise<void>;
  readonly head: (id: SessionId) => ReadFacts | undefined;
  /** Filters plugin end events to the selected main head without repeating its selection rule. */
  readonly isMainRun: (id: SessionId, run: RunId) => boolean;
  readonly dispose: () => void;
}

/** The SDK connection is adapted here. No UI receives its list/view or workspace wire records. */
export function createChatSource(connection: Connection, machine: Machine): ChatSource {
  // TODO Subscribe to sessionsWatch(all) once; filter roots only in sidebar/search selectors.
  // TODO Preserve first-frame roots as startup seeds until all arrives, never as a complete all index.
  // TODO Resolve direct-info misses, preserving loading/missing/failed distinctions.
  // TODO Call projectDirectory from existing watch references, preserving unchanged Chat identities.
  // TODO Git/GitHub enrichment is workspace-scoped and on demand, shared by cards and other location readers.
  // TODO Main-head view samples enter the projection before createTextPacer receives their text.
  // TODO ensureHistoryThrough shares the existing pager's opening/in-flight gates.
  // TODO Once opening settles, loadEarlier until raw oldest.at <= through or history is exhausted.
  // TODO Distinguish history prepends from newly eligible live messages at that pager boundary.
  // TODO Explicit markRead uses every current head's tip; automatic see uses the presented chosen head.
  // TODO SDK type validation already happened at this boundary; do not re-parse typed SDK records.
  // TODO Core remains the mark owner. Do not add cross-window read-state replication.
  throw new Error("not implemented");
}
```

## `runtime/chat-shell.ts`

```ts
import type { Connection } from "@nyte-ai/sdk/client";
import type { Chats, Machine } from "../chats/index.ts";
import { createChatSource } from "../chats/runtime.ts";
import { createChatWindow } from "../window/runtime.ts";
import type { WindowDependencies, WindowRuntime } from "../window/runtime.ts";

export interface ConnectedChatShell extends WindowRuntime {
  readonly chats: Chats;
}

/** Composition only. UI obtains the result through the bindings context, never a module-global host query. */
export function createChatShell(
  connection: Connection,
  machine: Machine,
  window: Omit<WindowDependencies, "chats">,
): ConnectedChatShell {
  // TODO const source = createChatSource(connection, machine).
  // TODO const runtime = createChatWindow({ ...window, chats: source }).
  // TODO Install the app completion plugin instead of the generic notifications completion plugin.
  // TODO Connect router adoption/mirroring and window/browser focus once; do not subscribe per transcript.
  // TODO Reset the connection-scoped directory on connection replacement, as sdk.installConnection already does.
  // TODO Dispose renderer bindings and source subscriptions with their existing owning lifetimes.
  throw new Error("not implemented");
}
```

## `runtime/completion-plugin.ts`

```ts
import type { Plugin } from "@nyte-ai/plugin/client";
import type { ChatSource } from "../chats/runtime.ts";
import type { WindowRenderer } from "../window/runtime.ts";

/** App-only completion adapter. Other clients keep their existing generic notification plugin. */
export function createCompletionPlugin(chats: ChatSource, renderer: WindowRenderer): Plugin {
  // TODO Implement only run_ended_anywhere. mountClientPlugins already seeds and deduplicates end events.
  // TODO chats.isMainRun uses mainHead on the originating all-list row, not api.session or the paced view.
  // TODO Adapt event.end to the domain RunOutcome, then call renderer.completed once.
  // TODO Notification policy reads looking, parent and descendant state inside window, at delivery time.
  // TODO Other plugins' ui.notify still passes through unchanged; never filter toasts by text/title heuristics.
  throw new Error("not implemented");
}
```

## `ui/chat-bindings.ts`

```ts
import type { SessionId } from "@nyte-ai/sdk/client";
import type { ChatResult } from "../chats/index.ts";
import type { ChatWindow, ComposerDraft, DraftOwner, ViewId, ViewSnapshot, WindowSnapshot } from "../window/index.ts";
import type { ConnectedChatShell } from "../runtime/chat-shell.ts";

/** Binds subscribe(id) and get(id). It acquires missing info/location data without render-time SDK calls. */
export function useChat(id: SessionId): ChatResult {
  throw new Error("not implemented");
}

export interface ChatWindowBinding {
  readonly actions: ChatWindow;
  readonly snapshot: WindowSnapshot;
}

export function useChatWindow(): ChatWindowBinding {
  throw new Error("not implemented");
}

export function useChatView(view: ViewId): ViewSnapshot | null {
  throw new Error("not implemented");
}

/** Draft value and editor writes share one per-window owner, independent of tab/pane mounting. */
export function useComposerDraft(owner: DraftOwner): {
  readonly value: ComposerDraft;
  readonly change: (draft: ComposerDraft) => void;
} {
  throw new Error("not implemented");
}

/** Composition entry used by the app root, not by ordinary components. */
export function installChatBindings(shell: ConnectedChatShell): () => void {
  // TODO Bind useSyncExternalStoreWithSelector to normalized records and window projections.
  // TODO The actual renderer bridge attaches composer/transcript ports once per placement, not per hot watch.
  // TODO Present only normalized eligibility/row/geometry facts; never send SessionView through public UI actions.
  // TODO Keep presentation baselines and mounted element registration separate from looking policy.
  // TODO Deliver each pending focus serial once, through the existing keyOwner rule.
  // TODO Base UI finalFocus is wired by this bridge to the same composer target; remove competing imperative refocus.
  // TODO A single key router orders clientActions, focused-widget handlers, type-to-compose and paste.
  throw new Error("not implemented");
}
```

## `usage.ts`

```ts
import type { SessionId } from "@nyte-ai/sdk/client";
import type { ChatView, ChatWindow } from "./window/index.ts";
import { useChat, useChatWindow, useChatView } from "./ui/chat-bindings.ts";

/** chrome/sidebar.tsx:81-93, :405-411. Gesture decoding stays in the row; navigation policy does not. */
export function useSidebarChatActions() {
  const binding = useChatWindow();
  const chatWindow = binding.actions;

  return {
    preview: (sessionId: SessionId) => chatWindow.openChat(sessionId, { kind: "preview" }),
    background: (sessionId: SessionId) => chatWindow.openChat(sessionId, { kind: "background" }),
    searchResult: (sessionId: SessionId) => chatWindow.openChat(sessionId, { kind: "permanent" }),
    beside: (sessionId: SessionId) => chatWindow.openChat(sessionId, {
      kind: "split",
      at: binding.snapshot.focusedPane,
      edge: "right",
    }),
    markRead: (sessions: readonly SessionId[]) => chatWindow.markRead(sessions),
  };
}

/** screens/session-conversation.tsx:510-514. No strip check and no parent replacement in the caller. */
export function useChildExpansion(parent: ChatView) {
  const chatWindow = useChatWindow().actions;

  return (childId: SessionId) => chatWindow.openChat(childId, {
    kind: "next-to-parent",
    parent: parent.id,
  });
}

/** tabs/use-window-tabs.tsx:137-189, shared chat-card.tsx:84-110, pane header:431. */
export function useChatHeader(sessionId: SessionId) {
  const result = useChat(sessionId);
  const window = useChatWindow().snapshot;

  if (result.kind !== "ready") return null;

  return {
    title: result.chat.title,
    run: result.chat.run.status,
    location: result.chat.location,
    unread: window.unread.has(sessionId),
  };
}

/** Timeline's visit state is read directly; the renderer still owns row geometry and pixel offsets. */
export function useNewMessageControls(view: ChatView) {
  const state = useChatView(view.id);
  const chatWindow = useChatWindow().actions;

  return {
    attention: state?.attention,
    reveal: () => chatWindow.act({ kind: "open-new", view: view.id }),
    dismiss: (direction: "up" | "down") => chatWindow.act({ kind: "dismiss-new", view: view.id, direction }),
  };
}

/** Existing composer onLeave, transcript jump control and model-picker close callbacks. */
export function useComposerCallbacks(view: ChatView) {
  const chatWindow = useChatWindow().actions;

  return {
    onSubmitted: () => chatWindow.act({ kind: "submitted", view: view.id }),
    onJumpEnd: () => chatWindow.act({ kind: "jump-end", view: view.id }),
    onPickerClosed: () => chatWindow.act({ kind: "picker-closed", view: view.id }),
    onUnreadOpen: () => chatWindow.act({ kind: "open-new", view: view.id }),
    onUnreadDismiss: (direction: "up" | "down") => chatWindow.act({ kind: "dismiss-new", view: view.id, direction }),
  };
}

/** conversation/draft-start.ts:91,104. Finishing a hidden draft cannot replace a newly selected chat. */
export function afterDraftStarted(chatWindow: ChatWindow, draft: string, sessionId: SessionId) {
  return chatWindow.openChat(sessionId, { kind: "started-draft", draft });
}
```

## `window/index.ts`

```ts
import type { Id, MessageId, SessionId, WorkspaceId } from "@nyte-ai/sdk/client";
import type { Chat, RunStatus } from "../chats/index.ts";

export type PaneId = "primary" | "secondary";

export interface PaneAddress {
  readonly tab: string;
  readonly pane: PaneId;
}

/** Issued by the window, used unchanged by callers. It names a placement, not a session. */
export type ViewId = Id<"chat-view">;

export interface ChatView {
  readonly id: ViewId;
  readonly chat: SessionId;
  readonly at: PaneAddress;
  readonly role: "pane" | "detail";
}

export type OpenIntent =
  | { readonly kind: "preview" }
  | { readonly kind: "permanent" }
  | { readonly kind: "background" }
  | { readonly kind: "next-to-parent"; readonly parent: ViewId }
  | { readonly kind: "split"; readonly at: PaneAddress; readonly edge: "left" | "right" | "top" | "bottom" }
  /** Centre drops replace a pane. This is not a low-level select-in-pane escape hatch. */
  | { readonly kind: "replace"; readonly at: PaneAddress }
  /** Resolving a new-chat send preserves that draft's owner, including when it is no longer shown. */
  | { readonly kind: "started-draft"; readonly draft: string };

export type OpenOutcome =
  | { readonly kind: "opened"; readonly view: ChatView }
  | { readonly kind: "not-shown" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "missing"; readonly chat: SessionId }
  | { readonly kind: "unavailable"; readonly reason: string };

export interface Divider {
  readonly row: string;
  readonly firstMessage: MessageId;
}

export type NewMessagesPill =
  | { readonly kind: "up"; readonly count: number; readonly label: string }
  | { readonly kind: "down"; readonly count: number; readonly label: string };

/** No pixel offsets or virtualizer objects. The transcript supplies geometry through its binding. */
export interface ViewAttention {
  readonly divider: Divider | null;
  readonly pill: NewMessagesPill | null;
  readonly showJumpEnd: boolean;
}

export interface ViewSnapshot {
  readonly view: ChatView;
  readonly entered: { readonly status: RunStatus; readonly unreadCompletion: boolean } | null;
  readonly shown: boolean;
  readonly looking: boolean;
  readonly attention: ViewAttention;
}

export interface TabSummary {
  readonly id: string;
  readonly title: string;
  readonly preview: boolean;
  readonly active: boolean;
  /** Focused pane first, including children. Used directly by the shared hover card. */
  readonly chats: readonly Chat[];
  /** Focused pane's exact shared status. Other pane blocks retain their own statuses. */
  readonly status: RunStatus | null;
  /** Any pane's unread completion, suppressed only while that chat is being looked at. */
  readonly unread: boolean;
}

export type PageDestination =
  | { readonly kind: "customize"; readonly section: string | null; readonly chat: SessionId | null }
  | { readonly kind: "environments"; readonly section: string | null };

export type Destination =
  | { readonly kind: "chat"; readonly chat: SessionId }
  | { readonly kind: "blank" }
  | PageDestination;

export interface WindowSnapshot {
  readonly destination: Destination;
  readonly tabs: readonly TabSummary[];
  readonly views: readonly ViewSnapshot[];
  readonly focusedPane: PaneAddress;
  /** Set membership is also used by the app completion-plugin adapter. Not active selection. */
  readonly looking: ReadonlySet<SessionId>;
  /** One window-specific unread-completion projection for sidebar, tabs and subagent links. */
  readonly unread: ReadonlySet<SessionId>;
}

/** Semantic UI actions. There is deliberately no open, set-layout, set-execution or set-seen action. */
export type ChatWindowAction =
  | { readonly kind: "open-page"; readonly page: PageDestination }
  | { readonly kind: "page-section"; readonly section: string }
  | { readonly kind: "activate-tab"; readonly tab: string }
  | { readonly kind: "focus-pane"; readonly at: PaneAddress }
  | { readonly kind: "close-tab"; readonly tab: string }
  | { readonly kind: "keep-tab"; readonly tab: string }
  | { readonly kind: "reopen-tab" }
  | { readonly kind: "reorder-tabs"; readonly dragged: string; readonly order: readonly string[] }
  | { readonly kind: "resize-split"; readonly tab: string; readonly ratio: number }
  | { readonly kind: "close-pane"; readonly at: PaneAddress }
  | { readonly kind: "new-chat"; readonly workspace: WorkspaceId | null }
  | { readonly kind: "open-draft"; readonly draft: string }
  | { readonly kind: "submitted"; readonly view: ViewId }
  | { readonly kind: "jump-end"; readonly view: ViewId }
  | { readonly kind: "open-new"; readonly view: ViewId }
  | { readonly kind: "dismiss-new"; readonly view: ViewId; readonly direction: "up" | "down" }
  | { readonly kind: "picker-closed"; readonly view: ViewId }
  | { readonly kind: "edit-started"; readonly view: ViewId }
  | { readonly kind: "detail-opened"; readonly parent: ViewId; readonly child: SessionId }
  | { readonly kind: "detail-closed"; readonly parent: ViewId };

export type DraftOwner =
  | { readonly kind: "chat"; readonly chat: SessionId }
  | { readonly kind: "draft"; readonly draft: string };

export interface ComposerDraft {
  readonly text: string;
  readonly selection: { readonly start: number; readonly end: number };
  readonly attachments: readonly {
    readonly id: string;
    readonly name: string;
    readonly mimeType: string;
    readonly data: string;
  }[];
}

/** The only writer of this window's placement, visits and focus requests. */
export interface ChatWindow {
  readonly getSnapshot: () => WindowSnapshot;
  readonly subscribe: (notice: () => void) => () => void;
  /** Failure to activate the folder never changes the current destination. Background never activates. */
  readonly openChat: (chat: SessionId, intent: OpenIntent) => Promise<OpenOutcome>;
  /** Open/activate actions and async failures terminate at the window's existing UI error boundary. */
  readonly act: (action: ChatWindowAction) => void;
  /** Explicit triage. Advances every current head; requires neither a view nor visibility. */
  readonly markRead: (chats: readonly SessionId[]) => Promise<void>;
}
```

## `window/internal/attention.ts`

```ts
import type { CommitId, MessageId, SessionId } from "@nyte-ai/sdk/client";
import type { Chat, Chats, RunOutcome } from "../../chats/index.ts";
import type { ChatSource } from "../../chats/runtime.ts";
import type { ViewAttention, ViewId } from "../index.ts";
import type { AttentionMessage, PresentedView, Visit, WindowState } from "./model.ts";

export interface Exposure {
  /** Active-tab pane/detail placements, including temporarily covered or not-yet-ready transcripts. */
  readonly visitingViews: ReadonlySet<ViewId>;
  readonly shownViews: ReadonlySet<ViewId>;
  readonly shownChats: ReadonlySet<SessionId>;
  readonly lookingViews: ReadonlySet<ViewId>;
  readonly lookingChats: ReadonlySet<SessionId>;
}

/** The single definition. Focused-pane selection does not limit either set. */
export function expose(state: WindowState): Exposure {
  // TODO Enumerate only active-tab pane placements, plus detail belonging to a shown parent.
  // TODO A page has no shown chat, even if the old pane tab is kept alive underneath.
  // TODO Require presented.ready and no full transcript cover. Never enumerate hot/warm mounted children.
  // TODO looking = shown AND document visible AND window focused. Both split panes and detail can qualify.
  // TODO Keep shown separate only for text pacing/render scheduling; not as a second read policy.
  throw new Error("not implemented");
}

export interface ReadRequest {
  readonly chat: SessionId;
  readonly tip: CommitId;
}

export interface Observation {
  readonly visits: ReadonlyMap<ViewId, Visit>;
  readonly read: readonly ReadRequest[];
}

/** Computes visit baselines before producing any see requests. No UI effect can reverse that order. */
export function observe(state: WindowState, exposure: Exposure): Observation {
  // TODO For a newly shown ready view, create its visit from presented.baseline before read[] is built.
  // TODO If the baseline is loading, wait. Mounting a viewport cannot fabricate a null baseline.
  // TODO Keep the same visit while unfocused/covered; freeze a following boundary at latest message time.
  // TODO Delete only when no longer in visitingViews, not on focus loss, cover or Activity cleanup.
  // TODO Advance each visit using normalized messages and live arrivals; capture an identity cursor on leaving end.
  // TODO Deduplicate automatic read requests by chat+tip across split/detail readers.
  // TODO Only looking views with a rendered tip request see. Scroll position is irrelevant.
  throw new Error("not implemented");
}

export function beginVisit(view: PresentedView, chat: Chat, unreadCompletion: boolean): Visit {
  // TODO Known(null) starts unmarked. Known(time) fixes a boundary at that pre-see value.
  // TODO A fixed boundary with no unread assistant anchor becomes following only while looking AND boundaryResolved.
  throw new Error("not implemented");
}

export function projectAttention(visit: Visit, messages: readonly AttentionMessage[]): ViewAttention {
  // TODO First eligible assistant started after fixed boundary supplies divider message and containing row.
  // TODO Until boundaryResolved, do not claim a tail-clipped first unread message/count is the real boundary.
  // TODO A collapsed group receives the divider before the group; expanded content uses the member row.
  // TODO Down is eligible only while not following and >60px from end, with a nonempty incoming identity set.
  // TODO Down wins and permanently acknowledges the existing up pill, without removing its divider.
  // TODO Otherwise up requires an unacknowledged divider above the viewport; its count excludes system-user.
  // TODO Counts above 30 display 30+; stored counts stay exact. Streaming never increments a count.
  // TODO Plain jump arrow is independent: overflow and >60px from end.
  throw new Error("not implemented");
}

export type VisitAction =
  | { readonly kind: "reveal" }
  | { readonly kind: "dismiss"; readonly direction: "up" | "down" };

export function actOnVisit(visit: Visit, action: VisitAction, view: PresentedView): Visit {
  // TODO Reveal only acknowledges. Transcript port places divider at one-third height, entering reading.
  // TODO Dismiss down resets known IDs to current eligible IDs, clears incoming, never scrolls or changes boundary.
  // TODO Dismiss up fixes boundary at latest message time and requests see through observe; no scroll.
  // TODO Scrolling across divider acknowledges its pill, never deletes the divider.
  throw new Error("not implemented");
}

/** Called only by the app plugin adapter. The plugin mount already excludes startup replay and duplicate ends. */
export interface Completion {
  readonly chat: SessionId;
  readonly outcome: RunOutcome;
}

export type CompletionNotice =
  | { readonly kind: "quiet" }
  | { readonly kind: "toast"; readonly title: string; readonly message: string; readonly level: "info" | "error" };

export function completionNotice(event: Completion, chats: Chats, exposure: Exposure): CompletionNotice {
  // TODO Adapter admits only main-head events, using the shared head selector.
  // TODO Quiet for child, stopped, being looked at, or root with active descendants.
  // TODO Quiet for an active own run with a different run ID. A lagging view of this same run does not suppress its end.
  // TODO Run-end events are authoritative for notification occurrence; chosen head remains authoritative for status.
  // TODO Completed => Run finished; failed => existing one-line failure text. Title is Chat.title.
  // TODO Do not queue a second notice when the window regains focus or descendants finish.
  throw new Error("not implemented");
}

/** The only unread-completion rule. Failures stay failed until a new run, and stopped never becomes unread. */
export function projectUnread(chats: Chats, source: ChatSource, exposure: Exposure): ReadonlySet<SessionId> {
  // TODO Chosen head unread AND self idle/completed AND no active descendants AND not in lookingChats.
  // TODO Tab dot, sidebar emphasis, filters and child links all consume this set; no active-tab exception elsewhere.
  throw new Error("not implemented");
}

/** Prefix-preserving identity accounting, not a time-based counter. History pages supply no arrivals. */
export function countArrivals(visit: Visit, arrivals: readonly MessageId[]): Visit {
  throw new Error("not implemented");
}
```

## `window/internal/model.ts`

```ts
import type { CommitId, MessageId, SessionId } from "@nyte-ai/sdk/client";
import type { RunStatus } from "../../chats/index.ts";
import type { ReadFacts } from "../../chats/runtime.ts";
import type { ChatView, PageDestination, PaneId, ViewId } from "../index.ts";
import type { DraftRecord, ScrollPosition } from "./storage.ts";

export type Selection =
  | { readonly kind: "chat"; readonly view: ChatView }
  | { readonly kind: "draft"; readonly draft: string };

export interface Pane {
  readonly id: PaneId;
  readonly selection: Selection;
}

export type PaneLayout =
  | { readonly kind: "single"; readonly pane: Pane }
  | {
      readonly kind: "split";
      readonly panes: readonly [Pane, Pane];
      readonly direction: "right" | "down";
      readonly ratio: number;
      readonly focused: PaneId;
    };

/** Blank and split tabs are always permanent. */
export interface PermanentTab {
  readonly id: string;
  readonly content:
    | { readonly kind: "page"; readonly page: PageDestination }
    | { readonly kind: "panes"; readonly layout: PaneLayout };
}

/** One optional preview value, not a boolean repeated over a tab array. */
export interface PreviewSlot {
  readonly id: string;
  readonly before: string | null;
  readonly view: ChatView;
}

export interface TabStrip {
  readonly permanent: readonly PermanentTab[];
  readonly preview: PreviewSlot | null;
  readonly active: string;
  readonly recent: readonly string[];
  readonly closed: readonly { readonly tab: PermanentTab; readonly index: number }[];
}

export interface WindowEnvironment {
  readonly visible: boolean;
  readonly focused: boolean;
  /** Full transcript covers only. Supplied by shell/workbench layout, not a DOM visibility heuristic. */
  readonly covered: ReadonlySet<ViewId>;
}

/** Only messages eligible under transcript spec 5.1 reach this boundary. */
export interface AttentionMessage {
  readonly id: MessageId;
  readonly at: number;
  readonly kind: "assistant" | "system-user";
  /** Row containing the message, after grouping/disclosure projection. */
  readonly row: string;
}

export interface TranscriptGeometry {
  readonly following: boolean;
  readonly distanceFromEnd: number;
  readonly overflowing: boolean;
  readonly divider: "missing" | "above" | "inside" | "below";
}

/** Renderer evidence. Being mounted or holding a watch is not evidence of being shown. */
export interface PresentedView {
  readonly view: ChatView;
  readonly ready: boolean;
  readonly tip: CommitId | null;
  readonly baseline: ReadFacts["baseline"];
  readonly messages: readonly AttentionMessage[];
  readonly history: { readonly kind: "all" } | { readonly kind: "tail"; readonly oldestAt: number };
  /** Newly eligible live messages in this update; first text counts once, history prepends never count. */
  readonly arrivals: readonly MessageId[];
  readonly geometry: TranscriptGeometry;
}

export type DividerBoundary =
  | { readonly kind: "unmarked" }
  | { readonly kind: "following" }
  | { readonly kind: "fixed"; readonly through: number };

export type ArrivalCursor =
  | { readonly kind: "following" }
  | {
      readonly kind: "reading";
      readonly known: ReadonlySet<MessageId>;
      readonly incoming: ReadonlySet<MessageId>;
    };

/** Exists only for a shown placement. Blur/cover freezes it; leaving the tab/chat deletes it. */
export interface Visit {
  /** Frozen entry facts support the sidebar shelf hold, without retaining a second current status. */
  readonly entered: { readonly status: RunStatus; readonly unreadCompletion: boolean };
  readonly boundary: DividerBoundary;
  /** False while an older baseline still lies before the pager's loaded tail. */
  readonly boundaryResolved: boolean;
  readonly acknowledged: MessageId | null;
  readonly arrival: ArrivalCursor;
  readonly geometry: TranscriptGeometry;
}

export interface FocusRequest {
  readonly serial: number;
  readonly view: ViewId;
  readonly reason: "open" | "tab" | "send" | "jump" | "picker" | "edit" | "detail-close";
  /** One window counter, captured before async navigation. Later deliberate input cancels delayed focus. */
  readonly interaction: number;
}

/** One write model. Maps are data structures, not separately writable service stores. */
export interface WindowState {
  readonly strip: TabStrip;
  readonly details: ReadonlyMap<ViewId, ChatView>;
  readonly environment: WindowEnvironment;
  readonly presented: ReadonlyMap<ViewId, PresentedView>;
  readonly visits: ReadonlyMap<ViewId, Visit>;
  readonly drafts: ReadonlyMap<string, DraftRecord>;
  readonly scroll: ReadonlyMap<SessionId, ReadonlyMap<"primary" | "secondary" | "detail", ScrollPosition>>;
  readonly disclosures: ReadonlyMap<SessionId, ReadonlyMap<string, boolean>>;
  readonly focus: FocusRequest | null;
  readonly focusSerial: number;
  readonly interaction: number;
}
```

## `window/internal/navigation.ts`

```ts
import type { Chat, ChatLocation } from "../../chats/index.ts";
import type { ChatSource } from "../../chats/runtime.ts";
import type { ChatWindow, OpenIntent, OpenOutcome } from "../index.ts";
import type { TabStrip, WindowState } from "./model.ts";

/** Privileged host bridge. This is the host's one active folder, never a location data source. */
export interface FolderActivation {
  readonly activate: (location: Exclude<ChatLocation, { readonly kind: "loading" }>) => Promise<boolean>;
}

export interface NavigationOwner {
  readonly read: () => WindowState;
  readonly publish: (state: WindowState) => void;
  readonly chats: ChatSource;
  readonly folder: FolderActivation;
  readonly strip: boolean;
  readonly nextId: () => string;
}

/** Internal owner of the one pending foreground choice. Reuses current serialized folder switching. */
export interface Navigation {
  readonly openChat: ChatWindow["openChat"];
  readonly activateTab: (tab: string) => void;
  readonly focusPane: (tab: string, pane: "primary" | "secondary") => void;
}

export function createNavigation(owner: NavigationOwner): Navigation {
  // TODO openChat resolves chat + workspace before calling host activation; loading is never coerced to Home.
  // TODO Missing, unavailable, rejected trust/open outcomes leave current tabs, route and focus unchanged.
  // TODO Background is a lasting insertion with no activation, focus, read or route effects.
  // TODO Each foreground request replaces the pending choice. Serialize host folder calls, as today's follow does.
  // TODO Once activation succeeds, check the choice is still wanted, then plan against current state and publish once.
  // TODO Capture interaction at invocation, not after awaiting activation. A later user gesture cancels focus only.
  // TODO Existing-tab activation and pane focus use this same folder-then-commit path, not router follow effects.
  // TODO Routes mirror published tabs. An external session route calls openChat(permanent), not raw dispatch.
  throw new Error("not implemented");
}

/** Pure placement. Neither queries a folder nor touches the DOM. The only session-placement writer. */
export function placeChat(
  state: WindowState,
  chat: Chat,
  intent: OpenIntent,
  strip: boolean,
  nextId: () => string,
): { readonly state: WindowState; readonly outcome: OpenOutcome } {
  // TODO Ordinary open first reveals the existing editable placement, without promoting a preview.
  // TODO Background existing is a no-op. There is at most one editable placement for a chat in a window.
  // TODO Explicit split/replace relocates an existing placement; promote affected previews before layout changes.
  // TODO next-to-parent validates the named parent view, keeps its preview, inserts after its actual tab.
  // TODO A pre-existing preview slot is reused in place before considering adjacency; replaced content is not closed.
  // TODO A blank permanent tab absorbs a foreground open and becomes preview only when the intent asks for one.
  // TODO No strip: use the window's chat tab, retaining parent/back behavior; caller never branches on strip mode.
  // TODO started-draft transfers current draft residual to chat draft; replace only if that draft is still visible.
  // TODO If a started draft is no longer visible, return not-shown and never steal another chat's pane.
  // TODO A stale explicit pane/parent target is cancelled, not redirected to whichever pane is active now.
  // TODO Issue ViewId with existing asId<"chat-view">; it is not interchangeable with a SessionId.
  // TODO Set one window-qualified focus request and end departed visits in the same state transition.
  throw new Error("not implemented");
}

/** Promotion preserves tab ID, view ID and physical position. Calling it twice changes nothing. */
export function keepPreview(strip: TabStrip, tab: string): TabStrip {
  throw new Error("not implemented");
}

/** Closure never stops a run. Replaced previews do not pass through this operation. */
export function closeTab(strip: TabStrip, tab: string, nextId: () => string): TabStrip {
  // TODO Explicitly closed preview enters history as PermanentTab; recent-first close fallback remains.
  // TODO Archive/delete invalidates entries through the existing session-action projection and cannot reopen them.
  // TODO Last close creates one blank permanent tab. No blank preview can be constructed.
  throw new Error("not implemented");
}
```

## `window/internal/runtime.ts`

```ts
import type { ComposerDraft, ChatWindow, Destination, DraftOwner, ViewId, ViewSnapshot } from "../index.ts";
import type { ChatSource } from "../../chats/runtime.ts";
import type { Completion } from "./attention.ts";
import type { FolderActivation } from "./navigation.ts";
import type { PresentedView, WindowEnvironment } from "./model.ts";

/** Commands execute through the existing scroll engine. Only that engine writes pixel offsets. */
export interface ViewPorts {
  readonly composer: {
    readonly element: () => HTMLElement | null;
    readonly focus: () => void;
    readonly openModelPicker: () => void;
  } | null;
  readonly transcript: {
    readonly end: () => void;
    readonly reveal: (row: string, fraction: number) => void;
  };
}

/** Privileged renderer boundary. Never exported from window/index or given to rows/tool content. */
export interface WindowRenderer {
  readonly view: (id: ViewId) => ViewSnapshot | null;
  readonly attach: (view: ViewId, ports: ViewPorts) => () => void;
  readonly present: (view: PresentedView) => void;
  readonly environment: (environment: WindowEnvironment) => void;
  readonly interacted: () => void;
  readonly draft: (owner: DraftOwner) => ComposerDraft;
  readonly editDraft: (owner: DraftOwner, value: ComposerDraft) => void;
  /** Supplied by the app completion adapter, not arbitrary plugin notify calls. */
  readonly completed: (completion: Completion) => void;
  readonly dispose: () => void;
}

export interface WindowRuntime {
  readonly window: ChatWindow;
  readonly renderer: WindowRenderer;
}

export interface WindowDependencies {
  readonly chats: ChatSource;
  readonly folder: FolderActivation;
  readonly windowId: string;
  readonly storage: Storage | undefined;
  readonly strip: boolean;
  readonly nextId: () => string;
  /** Uses the existing shell key-owner selector, not another DOM probe. */
  readonly keyOwner: () => HTMLElement | undefined;
  readonly notify: (notice: { readonly title: string; readonly message: string; readonly level: "info" | "error" }) => void;
  readonly navigateRoute: (destination: Destination) => void;
  readonly report: (error: unknown) => void;
}

/** Creates the sole window state owner; not another wrapper around WindowTabs and PaneController. */
export function createChatWindow(dependencies: WindowDependencies): WindowRuntime {
  // TODO Create persistence inside this owner; bootstrap supplies windowId/storage, not a second state store.
  // TODO Use navigation's plan and the one window state; delete controller.show/layout callback round trips.
  // TODO On every state/presentation/input change derive exposure, then initialize/update visits, publish, then see.
  // TODO After opening/restore settles, a baseline outside the 40-message tail uses chats.ensureHistoryThrough.
  // TODO Share the existing pager's in-flight gate; never fetch earlier history during opening.
  // TODO Keep the baseline while that history loads; never display a truncated up count as an exact count.
  // TODO Retry automatic see on a later real observation after failure, not from a timer or hidden watch.
  // TODO Submitted promotes and follows immediately, before transport response; failed-send draft recovery stays intact.
  // TODO jump-end scrolls then requests composer focus.
  // TODO open-new consults the current pill: down ends/follows without focus; up reveals at one-third in reading.
  // TODO Neither pill-body operation focuses the composer or removes the divider.
  // TODO Picker close/edit/detail close request focus for their named view, not whichever pane later becomes active.
  // TODO Deliver a focus request only for its current active eligible target and the captured interaction counter.
  // TODO Respect keyOwner outside that editor/pane. Never steal from dialog/menu/listbox/another field.
  // TODO Attach satisfies a pending focus request only once; detached or replaced targets cancel it.
  // TODO One window serial replaces each tab controller's local focus revision. No persisted focused boolean.
  // TODO Bind one shell key router for shortcuts, type-to-compose, paste and model picker using existing precedence.
  // TODO Event-local suggestion/edit/tray Escape handling remains in composer before global key routing.
  // TODO On completion read the current looking set; generic plugin notifications keep their existing behavior.
  // TODO Error handling terminates at report; pure policy functions do not swallow failures.
  throw new Error("not implemented");
}
```

## `window/internal/storage.ts`

```ts
import type { MessageId, ModelRef, SessionId, Thinking } from "@nyte-ai/sdk/client";
import type { ComposerDraft, DraftOwner, PaneId } from "../index.ts";
import type { PermanentTab, WindowState } from "./model.ts";

export type ScrollPosition =
  | { readonly kind: "end" }
  | { readonly kind: "anchor"; readonly row: string; readonly firstMessage: MessageId; readonly offset: number };

export type DraftStatus =
  | { readonly kind: "editing" }
  | { readonly kind: "waiting" }
  | { readonly kind: "starting" }
  | { readonly kind: "refused"; readonly message: string; readonly fix: "choose-model" | null }
  | { readonly kind: "failed"; readonly message: string };

export interface DraftRecord {
  readonly owner: DraftOwner;
  readonly composer: ComposerDraft;
  readonly status: DraftStatus;
  readonly updatedAt: number;
  /** New-chat model choice stays with this draft; schema/capability interpretation remains in composer. */
  readonly choice: { readonly model: ModelRef; readonly thinking: Thinking | undefined } | null;
}

/** This type cannot contain a preview, read visit, focus request or cached virtualizer measurement. */
export interface SavedWindow {
  readonly tabs: readonly PermanentTab[];
  readonly active: string;
  readonly recent: readonly string[];
  readonly closed: readonly { readonly tab: PermanentTab; readonly index: number }[];
}

export interface WindowPersistence {
  readonly tabs: () => unknown;
  readonly draft: (owner: DraftOwner) => unknown;
  readonly writeTabs: (state: SavedWindow) => void;
  readonly writeDraft: (draft: DraftRecord) => void;
  readonly flush: () => void;
}

/** Boundary retains the existing keys and codecs; changing folders never changes a draft's key. */
export function createPersistence(windowId: string, storage: Storage | undefined): WindowPersistence {
  // TODO Keep nyte.window.v1:<windowId>:tabs, :drafts:session:<id>, :drafts:draft:<id>, attachments and index keys.
  // TODO Adapt the builder/tab record representation at this boundary, not by teaching domain types legacy unions.
  // TODO Draft/attachment flush stays 200ms per owner; tabs stay 250ms, both flush on pagehide.
  // TODO Web retains its existing window key and draft persistence; it still does not persist the tab strip.
  // TODO Parse unknown localStorage values once with existing TypeBox schemas. Storage failures end here.
  // TODO Existing global sidebar preference keys are kept unchanged by the preferences module.
  throw new Error("not implemented");
}

export function saveWindow(state: WindowState): SavedWindow {
  // TODO Serialize permanent tabs only. A preview active at shutdown selects recent surviving permanent or a blank.
  // TODO Closed entries already contain only PermanentTab. Explicitly closed previews reopen as permanent.
  // TODO Never save visits, pill acknowledgement, arrival cursors, focus, scroll or disclosure state.
  throw new Error("not implemented");
}

/** Reuses the window's draft records; it does not allocate another composer-state store per pane. */
export function updateDraft(state: WindowState, owner: DraftOwner, composer: ComposerDraft): WindowState {
  // TODO Replace only this owner; schedule its existing persisted record off the keystroke path.
  // TODO Do not store focused. Editing-message/queue target, recall cursor and picker state remain composer-local.
  throw new Error("not implemented");
}

export function rememberScroll(
  state: WindowState,
  chat: SessionId,
  pane: PaneId | "detail",
  position: ScrollPosition,
): WindowState {
  // TODO Preserve the existing 64-chat memory bound. Detail is a reader separate from either full pane.
  // TODO A synthetic unread divider is never a saved anchor; use its real neighboring message row.
  // TODO No per-chat split/focusedPane memory: tab layout is the only layout record.
  throw new Error("not implemented");
}
```

## `window/runtime.ts`

```ts
/** Privileged entry point for runtime/chat-shell, runtime/completion-plugin and ui/chat-bindings only. */
export { createChatWindow } from "./internal/runtime.ts";
export type { ViewPorts, WindowDependencies, WindowRenderer, WindowRuntime } from "./internal/runtime.ts";
```
