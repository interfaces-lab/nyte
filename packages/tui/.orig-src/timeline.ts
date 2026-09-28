import {
  BoxRenderable,
  CliRenderEvents,
  CodeRenderable,
  LayoutEvents,
  RenderableEvents,
  TextBuffer,
  TextBufferRenderable,
  TextBufferView,
} from "@opentui/core";
import type {
  CliRenderer,
  Renderable,
  ScrollUnit,
  Selection,
  SimpleHighlight,
} from "@opentui/core";
import { Edge } from "@opentui/core/yoga";
import { waitingCall } from "@nyte-ai/client";
import type { SessionState } from "@nyte-ai/client";
import type { RunInfo, Turn } from "@nyte-ai/core";
import { isTerminalPhase } from "@nyte-ai/protocol";
import { diffChars } from "diff";
import type { ShellExecution } from "./local-shell.ts";
import { SPACING } from "./constants.ts";
import { appendMarker, type MarkerProps } from "./marker.ts";
import { bufferWidths, repaintTree, TranscriptDisclosures, type Transcript } from "./surface.ts";
import {
  highlightSources,
  ToolCard,
  TurnBlock,
  type TurnSection,
  type TurnStatus,
} from "./transcript.ts";
import { cellOffset } from "./width.ts";

// ---------------------------------------------------------------------------
// The whole transcript
// ---------------------------------------------------------------------------

function messageId(item: Turn | ShellEntry): string {
  switch (item.kind) {
    case "turn":
      return `turn:${item.id}`;
    case "shell":
      return `shell:${item.execution.id}`;
    default:
      return `${item.kind}:${item.commit}`;
  }
}

/** A non-turn item as the marker between turns. */
function markerProps(item: Exclude<Turn, { kind: "turn" }>): MarkerProps {
  switch (item.kind) {
    case "checkpoint":
      return {
        variant: "border",
        content: `context compacted · ${String(item.body.tokensBefore)} tokens before`,
        summary: item.body.summary,
      };
    case "summary":
      return { variant: "border", content: "branch summary", summary: item.body.text };
    case "config": {
      const parts: string[] = [];

      if (item.body.model !== undefined) {
        const { provider, id } = item.body.model;
        parts.push(`Model → ${provider === undefined ? id : `${provider}/${id}`}`);
      }

      if (item.body.thinkingLevel !== undefined)
        parts.push(`Thinking → ${item.body.thinkingLevel}`);

      if (item.body.agent !== undefined) parts.push(`Agent → ${item.body.agent}`);

      return { variant: "default", content: parts.join(" · ") };
    }

    default: {
      const _exhaustive: never = item;

      return _exhaustive;
    }
  }
}

/** A turn that has drawn no answer: only its request, or nothing at all (a completion's turn). */
function isRequestOnly(turn: Extract<Turn, { kind: "turn" }>): boolean {
  return turn.parts.length === 0 || (turn.parts.length === 1 && turn.parts[0]?.kind === "user");
}

/**
 * The status of a turn no run is streaming into: the record's outcome, or the
 * run's when it is the run that answered it. A bare request that no run has
 * answered stays unanswered; a run that ended on it (with nothing to say, or
 * by stopping) settles it.
 */
function settledStatus(
  turn: Extract<Turn, { kind: "turn" }>,
  run: RunInfo | undefined,
): Extract<TurnStatus, { kind: "unanswered" | "settled" }> {
  const answered = run !== undefined && run.startedAt >= turn.startedAt;

  if (!answered) {
    return isRequestOnly(turn) && turn.failure === undefined
      ? { kind: "unanswered" }
      : { kind: "settled", failure: turn.failure };
  }

  switch (run.phase.kind) {
    case "aborted":
      return {
        kind: "settled",
        failure: turn.failure ?? { class: "aborted", message: "Run stopped." },
      };
    case "failed":
      return { kind: "settled", failure: turn.failure ?? run.phase.failure };
    case "done":
    case "respond":
    case "tools":
    case "waiting":
    case "retry":
      return { kind: "settled", failure: turn.failure };
    default: {
      const _exhaustive: never = run.phase;

      return _exhaustive;
    }
  }
}

/** Measured rows are hints, never a limit on how much history can be reached. */
const HEIGHT_CACHE_LIMIT = 1024;

/** Rows short of the end that still count as being at it. */
const SCROLL_EDGE_THRESHOLD = 1;

/** One of the user's `!` jobs, shown among the turns where it started. */
interface ShellEntry {
  readonly kind: "shell";
  readonly execution: ShellExecution;
  readonly note: string | undefined;
}

interface TranscriptItem {
  readonly messageId: string;
  /** The row starts a turn, where turn navigation stops. */
  readonly scrollAnchor: boolean;
  readonly source: Turn | ShellEntry;
  readonly item: Turn | ShellEntry;
  readonly disclosures: TranscriptDisclosures;
  height: number;
}

type MountedItem =
  | { readonly kind: "turn"; readonly root: TurnSection; readonly block: TurnBlock }
  | { readonly kind: "marker"; readonly root: Renderable }
  | { readonly kind: "shell"; readonly root: BoxRenderable; readonly card: ToolCard };

function entryTime(entry: Turn | ShellEntry): number {
  switch (entry.kind) {
    case "turn":
      return entry.startedAt;
    case "shell":
      return entry.execution.startedAt;
    default:
      return entry.at;
  }
}

function layoutY(node: Renderable): number {
  return (
    node.getLayoutNode().getComputedLayout().top +
    node.translateY +
    (node.parent === null ? 0 : layoutY(node.parent))
  );
}

interface ReadingAnchor {
  readonly index: number;
  readonly row: number;
  readonly text?: {
    readonly node: TextBufferRenderable;
    readonly offset: number;
    readonly screenRow: number;
    readonly widthMethod: CliRenderer["widthMethod"];
  };
}

type TextChange = Pick<ReturnType<typeof diffChars>[number], "value" | "added" | "removed">;

/** Follow OpenTUI's highlight boundaries, including replacement and concealed spaces. */
function concealChanges(source: string, highlights: SimpleHighlight[]): TextChange[] {
  const boundaries = highlights
    .flatMap(([start, end], index) =>
      start === end
        ? []
        : [
            { offset: start, start: true, index },
            { offset: end, start: false, index },
          ],
    )
    .toSorted(
      (left, right) => left.offset - right.offset || Number(left.start) - Number(right.start),
    );

  const active = new Set<number>();
  const changes: TextChange[] = [];
  let cursor = 0;

  for (const boundary of boundaries) {
    if (cursor < boundary.offset) {
      const conceal = [...active]
        .map((index) => highlights[index])
        .find(
          (highlight) =>
            highlight !== undefined &&
            (highlight[3]?.conceal !== undefined ||
              highlight[2] === "conceal" ||
              highlight[2].startsWith("conceal.")),
        );

      changes.push({
        value: source.slice(cursor, boundary.offset),
        removed: conceal !== undefined,
        added: false,
      });

      if (conceal !== undefined) {
        const replacement =
          conceal[3]?.conceal !== undefined
            ? (conceal[3].conceal ?? "")
            : conceal[2] === "conceal.with.space"
              ? " "
              : "";

        if (replacement !== "") changes.push({ value: replacement, added: true, removed: false });
      }
    }

    if (boundary.start) active.add(boundary.index);
    else active.delete(boundary.index);
    cursor = boundary.offset;

    if (boundary.start) continue;
    const highlight = highlights[boundary.index];
    const meta = highlight?.[3];

    if (
      (meta?.concealLines !== undefined && source[cursor] === "\n") ||
      (source[cursor] === " " &&
        (meta?.conceal === " " ||
          (meta?.conceal === "" && highlight?.[2] === "conceal" && !meta.isInjection)))
    ) {
      changes.push({ value: source[cursor] ?? "", removed: true, added: false });
      cursor += 1;
    }
  }

  if (cursor < source.length)
    changes.push({ value: source.slice(cursor), added: false, removed: false });

  return changes;
}

/** Map the actual native buffer, including conceal replacements, not markdown guesses. */
const textMappings = new WeakMap<
  CodeRenderable,
  {
    source: string;
    text: string;
    changes: TextChange[];
  }
>();

function textOffset(node: TextBufferRenderable, offset: number, toSource: boolean): number {
  if (!(node instanceof CodeRenderable) || node.content === node.plainText) return offset;
  let mapping = textMappings.get(node);

  if (mapping?.source !== node.content || mapping.text !== node.plainText) {
    const highlighted = highlightSources.get(node);

    const changes =
      node.conceal && highlighted?.source === node.content && highlighted.text === node.plainText
        ? concealChanges(highlighted.source, highlighted.highlights)
        : diffChars(node.content, node.plainText);

    mapping = { source: node.content, text: node.plainText, changes };
    textMappings.set(node, mapping);
  }

  let from = 0;
  let to = 0;

  for (const change of mapping.changes) {
    const removed = toSource ? change.added : change.removed;
    const added = toSource ? change.removed : change.added;
    const length = change.value.length;

    if (added) {
      to += length;
      continue;
    }

    if (offset < from + length) return to + (removed ? 0 : offset - from);
    from += length;

    if (!removed) to += length;
  }

  return to;
}

/**
 * Only the viewport, one viewport of overscan on either side, and the tail are
 * mounted. Spacers stand in for the rest. A selection temporarily retains its
 * whole range because OpenTUI copies from mounted text buffers.
 */
export class Timeline {
  private readonly transcript: Transcript;
  private readonly mounted = new Map<number, MountedItem>();
  private readonly spacers: BoxRenderable[] = [];
  private readonly heights = new Map<
    string,
    { readonly source: Turn | ShellEntry; readonly height: number }
  >();
  private items: TranscriptItem[] = [];
  /** A local shell card may follow the still-streaming conversation turn. */
  private lastTurnIndex = -1;
  private offsets: number[] = [0];
  private state: SessionState | undefined;
  private geometry = "";
  private queued = false;
  private changingLayout = false;
  private pendingAnchor: ReadingAnchor | "bottom" | undefined;
  private reading: { readonly top: number; readonly anchor: ReadingAnchor | "bottom" } | undefined;
  private followMode: "latest" | "history" = "latest";
  /** The turn selected with Ctrl+Up/Down; it survives physical clamping near the tail. */
  private navigationKey: string | undefined;
  /** Blank rows after the tail so a selected turn can reach the viewport top. */
  private readonly navigationSpacer: BoxRenderable;
  private navigationSlack = 0;
  private selectionRange:
    | { readonly selection: Selection; readonly start: number; readonly end: number }
    | undefined;
  private liveTurn: { readonly key: string; readonly block: TurnBlock } | undefined;
  /** Content after the last turn that is not a turn: the messages still waiting to become one. */
  private readonly tail: Renderable | undefined;
  /** The user's `!` jobs on this head. Jobs, not commits: they join the items by start time. */
  private readonly shellEntries = new Map<string, ShellEntry>();
  private shellChanged = false;
  private readonly shellPositions = new Map<string, number>();

  constructor(transcript: Transcript, options: { readonly tail?: Renderable } = {}) {
    this.transcript = transcript;
    this.tail = options.tail;
    this.navigationSpacer = new BoxRenderable(transcript.renderer, {
      id: transcript.nextId("navigation-slack"),
      width: "100%",
      height: 0,
      flexShrink: 0,
    });
    transcript.renderer.setFrameCallback(this.beforeFrame);
    transcript.renderer.root.on(LayoutEvents.LAYOUT_CHANGED, this.restoreAnchor);
    transcript.renderer.on(CliRenderEvents.FRAME, this.scheduleLayout);
    transcript.renderer.on(CliRenderEvents.SELECTION, this.scheduleLayout);
    transcript.container.once(RenderableEvents.DESTROYED, () => {
      transcript.renderer.removeFrameCallback(this.beforeFrame);
      transcript.renderer.root.off(LayoutEvents.LAYOUT_CHANGED, this.restoreAnchor);
      transcript.renderer.off(CliRenderEvents.FRAME, this.scheduleLayout);
      transcript.renderer.off(CliRenderEvents.SELECTION, this.scheduleLayout);
      this.clear();
      this.navigationSpacer.destroy();
    });
  }

  /** Diagnostic count; cached widths are bounded independently of durable history. */
  get cachedHeightCount(): number {
    return this.heights.size;
  }

  /** Diagnostic count; the mounted window stays bounded independently of durable history. */
  get mountedItemCount(): number {
    return this.mounted.size;
  }

  /** Temporary space exists only while turn navigation needs to align the tail. */
  get navigationSlackRows(): number {
    return this.navigationSlack;
  }

  get isFollowingLatest(): boolean {
    return this.followMode === "latest";
  }

  /** Call after the owning shell updates its theme and syntax styles. */
  retheme(): void {
    this.pendingAnchor ??= this.anchor();

    for (const mounted of this.mounted.values()) repaintTree(mounted.root);

    if (this.liveTurn !== undefined) repaintTree(this.liveTurn.block.root);
    this.transcript.renderer.requestRender();
  }

  /** Progress replaces one card; only a new command changes transcript order. */
  syncShell(execution: ShellExecution, note: string | undefined): void {
    const state = this.state;

    if (state === undefined) return;
    const entry: ShellEntry = { kind: "shell", execution, note };
    this.shellEntries.set(execution.id, entry);
    const index = this.shellPositions.get(execution.id);
    const item = index === undefined ? undefined : this.items[index];

    if (index !== undefined && item !== undefined) {
      this.pendingAnchor ??= this.anchor();
      this.items[index] = { ...item, source: entry, item: entry };
      const mounted = this.mounted.get(index);

      if (mounted !== undefined) this.syncMounted(index, mounted);
      this.scheduleLayout();
      this.transcript.renderer.requestRender();

      return;
    }

    this.shellChanged = true;
    this.sync(state);
  }

  /** The turns and shell jobs in start order; a job goes before the first item that started after it. */
  private entries(source: readonly Turn[]): readonly (Turn | ShellEntry)[] {
    if (this.shellEntries.size === 0) return source;

    const jobs = [...this.shellEntries.values()].toSorted(
      (left, right) =>
        left.execution.startedAt - right.execution.startedAt ||
        left.execution.id.localeCompare(right.execution.id),
    );

    const merged: (Turn | ShellEntry)[] = [];
    let next = 0;

    for (const item of source) {
      while (next < jobs.length && entryTime(jobs[next] ?? item) < entryTime(item)) {
        merged.push(jobs[next] ?? item);
        next += 1;
      }

      merged.push(item);
    }

    return [...merged, ...jobs.slice(next)];
  }

  sync(state: SessionState, options: { readonly reset?: boolean } = {}): void {
    const previous = this.state;
    const source = state.transcript.items;
    const changed = previous?.transcript.items !== source || this.shellChanged;
    this.shellChanged = false;

    const reset =
      options.reset === true ||
      previous?.sessionId !== state.sessionId ||
      previous?.head !== state.head ||
      (changed &&
        previous !== undefined &&
        (source.length < previous.transcript.items.length ||
          previous.transcript.items.some(
            (item, index) => messageId(item) !== messageId(source[index] ?? item),
          )));

    if (reset) this.clear();
    this.state = state;

    if (changed || reset) {
      this.pendingAnchor ??= this.anchor();

      const old =
        this.shellEntries.size === 0
          ? undefined
          : new Map(this.items.map((item) => [item.messageId, item]));

      const next: TranscriptItem[] = [];

      for (const item of this.entries(source)) {
        const preceding = next.at(-1);

        // A config run is one display item, not one mounted node per commit.
        const merged =
          item.kind === "config" && preceding?.item.kind === "config"
            ? { ...item, body: { ...preceding.item.body, ...item.body } }
            : item;

        if (merged !== item) next.pop();
        const id = messageId(item);
        const candidate = old === undefined ? this.items[next.length] : old.get(id);
        const existing = candidate?.messageId === id ? candidate : undefined;
        next.push(
          existing?.source === item
            ? existing
            : {
                messageId: id,
                scrollAnchor: item.kind === "turn",
                source: item,
                item: merged,
                disclosures: existing?.disclosures ?? new TranscriptDisclosures(),
                height: existing?.height ?? (item.kind === "turn" ? 8 : 3),
              },
        );
      }

      for (const [index, mounted] of this.mounted) {
        const before = this.items[index];
        const after = next[index];

        if (
          before?.messageId !== after?.messageId ||
          (mounted.kind === "marker" && before?.source !== after?.source)
        ) {
          mounted.root.parent?.remove(mounted.root);
          mounted.root.destroyRecursively();
          this.mounted.delete(index);
        }
      }

      this.items = next;
      this.shellPositions.clear();
      this.lastTurnIndex = -1;

      for (const [index, item] of next.entries()) {
        if (item.item.kind === "shell") this.shellPositions.set(item.item.execution.id, index);
        else if (item.item.kind === "turn" && item.source === source.at(-1))
          this.lastTurnIndex = index;
      }

      this.reindex();
      this.transcript.onEmptyChange(next.length === 0);
    }

    this.reconcileWindow();

    if (changed || reset) {
      for (const [index, mounted] of this.mounted) this.syncMounted(index, mounted);
    } else {
      const last = this.mounted.get(this.lastTurnIndex);

      if (last !== undefined) this.syncMounted(this.lastTurnIndex, last);
    }

    const last = source.at(-1);

    if (state.compaction !== undefined && (!this.running() || last?.kind !== "turn")) {
      const key = `compaction:${state.compaction.id}`;

      if (this.liveTurn?.key !== key) {
        this.liveTurn?.block.remove();
        this.liveTurn = { key, block: new TurnBlock(this.transcript, key, 0) };
      }

      this.liveTurn.block.sync(undefined, { kind: "compacting" });
    } else if (this.running() && last?.kind !== "turn" && state.run !== undefined) {
      const key = `live:${state.run.runId}`;

      if (this.liveTurn?.key !== key) {
        this.liveTurn?.block.remove();
        this.liveTurn = { key, block: new TurnBlock(this.transcript, key, 0) };
      }

      this.liveTurn.block.sync(undefined, {
        kind: "open",
        phase: state.run.phase,
        live: state.overlay,
        waitingForUser: waitingCall(state) !== undefined,
      });
    } else if (this.liveTurn !== undefined) {
      this.liveTurn.block.remove();
      this.liveTurn = undefined;
    }

    if (reset) this.pendingAnchor = "bottom";
    this.scheduleLayout();
  }

  /** Logical navigation includes turns that have no renderable yet. */
  jumpTurn(direction: "previous" | "next"): boolean {
    const indices = this.items.flatMap((item, index) => (item.scrollAnchor ? [index] : []));
    const selected = indices.findIndex(
      (index) => this.items[index]?.messageId === this.navigationKey,
    );
    const top = this.transcript.container.scrollTop;

    const index =
      selected >= 0
        ? indices[selected + (direction === "next" ? 1 : -1)]
        : direction === "next"
          ? indices.find((candidate) => this.offset(candidate) + SPACING.block > top)
          : indices.findLast((candidate) => this.offset(candidate) + SPACING.block < top);

    const item = index === undefined ? undefined : this.items[index];

    if (index === undefined || item === undefined) return false;

    this.setFollowMode("history");
    this.navigationKey = item.messageId;
    this.reading = undefined;
    const target = this.offset(index) + SPACING.block;
    // A tail target clamps until the spacer is laid out; restoreAnchor applies it in-frame.
    this.pendingAnchor = { index, row: SPACING.block };
    this.setNavigationSlack(this.slackForTarget(target));
    this.transcript.container.scrollTo(target);
    this.reconcileWindow(target);
    this.scheduleLayout();
    this.transcript.renderer.requestRender();

    return true;
  }

  /** Page keys take physical ownership and end logical turn navigation. */
  scrollBy(delta: number, unit: ScrollUnit = "absolute"): void {
    this.beginManualScroll();
    this.transcript.container.scrollBy(delta, unit);
  }

  /**
   * Called before OpenTUI moves this viewport for a wheel event. A stale anchor
   * must not scroll back over the user's move, so the new one is captured after.
   */
  beginManualScroll(): void {
    this.endNavigation();
    this.setFollowMode("history");
    this.pendingAnchor = undefined;
    this.reading = undefined;
    queueMicrotask(this.finishManualScroll);
  }

  /** Clear all viewport ownership and follow subsequent output at the tail. */
  scrollToEnd(): void {
    this.endNavigation();
    this.pendingAnchor = "bottom";
    this.reading = undefined;
    this.setFollowMode("latest");
    this.transcript.container.scrollTo(Infinity);
    this.reconcileWindow();
    this.scheduleLayout();
    this.transcript.renderer.requestRender();
  }

  clear(): void {
    for (const mounted of this.mounted.values()) {
      mounted.root.parent?.remove(mounted.root);
      mounted.root.destroyRecursively();
    }

    this.mounted.clear();
    this.heights.clear();

    for (const spacer of this.spacers.splice(0)) {
      spacer.parent?.remove(spacer);
      spacer.destroy();
    }

    this.endNavigation();
    this.liveTurn?.block.remove();
    this.liveTurn = undefined;
    this.shellEntries.clear();
    this.shellPositions.clear();
    this.items = [];
    this.lastTurnIndex = -1;
    this.offsets = [0];
    this.state = undefined;
    this.geometry = "";
    this.selectionRange = undefined;
    this.reading = undefined;
    this.pendingAnchor = "bottom";
    this.setFollowMode("latest");
  }

  /** OpenTUI's bottom pin is on exactly while output growth owns the viewport. */
  private setFollowMode(mode: "latest" | "history"): void {
    if (this.followMode === mode) return;
    this.followMode = mode;
    this.transcript.container.stickyScroll = mode === "latest";
    this.transcript.onFollowModeChange(mode === "latest");
  }

  /**
   * Content rows without navigation space. scrollHeight comes from the last Yoga
   * pass, so subtract the slack that pass measured (NaN before the first pass)
   * rather than the rows requested since.
   */
  private naturalHeight(): number {
    const measuredSlack = this.navigationSpacer.getLayoutNode().getComputedLayout().height || 0;

    return this.transcript.container.scrollHeight - measuredSlack;
  }

  /** Compares against the requested slack; a wheel step that cancels navigation lands on the natural tail. */
  private atBottom(): boolean {
    const scroll = this.transcript.container;
    const bottom = this.naturalHeight() + this.navigationSlack - scroll.viewport.height;

    return scroll.scrollTop >= Math.max(0, bottom) - SCROLL_EDGE_THRESHOLD;
  }

  private viewportRows(): number {
    return Math.max(
      1,
      this.transcript.container.viewport.height || this.transcript.renderer.height,
    );
  }

  /** Runs after OpenTUI moved the viewport, unless another owner took over meanwhile. */
  private readonly finishManualScroll = (): void => {
    if (this.followMode !== "history" || this.navigationKey !== undefined) return;

    if (this.transcript.container.isDestroyed) return;

    if (this.atBottom()) {
      this.scrollToEnd();

      return;
    }

    this.pendingAnchor ??= this.captureReadingAnchor();
    this.reconcileWindow();
    this.scheduleLayout();
    this.transcript.renderer.requestRender();
  };

  private slackForTarget(target: number): number {
    return Math.max(0, target + this.viewportRows() - this.naturalHeight());
  }

  private setNavigationSlack(rows: number): void {
    this.navigationSlack = rows;
    this.navigationSpacer.height = rows;
  }

  private endNavigation(): void {
    this.navigationKey = undefined;
    this.setNavigationSlack(0);
  }

  private running(): boolean {
    const run = this.state?.run;

    return run !== undefined && !isTerminalPhase(run.phase);
  }

  private syncMounted(index: number, mounted: MountedItem): void {
    const item = this.items[index]?.item;
    const state = this.state;

    if (mounted.kind === "shell" && item?.kind === "shell") {
      mounted.card.sync(item.execution, undefined, false);
      mounted.card.setNote(item.note);

      return;
    }

    if (mounted.kind !== "turn" || item?.kind !== "turn" || state === undefined) return;
    const last = index === this.lastTurnIndex;
    mounted.block.sync(
      item,
      last && this.running() && state.run !== undefined
        ? state.compaction !== undefined
          ? { kind: "compacting" }
          : {
              kind: "open",
              phase: state.run.phase,
              live: state.overlay,
              waitingForUser: waitingCall(state) !== undefined,
            }
        : settledStatus(item, last ? state.run : undefined),
    );
  }

  private offset(index: number): number {
    return this.offsets[index] ?? 0;
  }

  private reindex(start = 0): void {
    this.offsets.length = start + 1;
    this.offsets[0] = 0;

    for (let index = start; index < this.items.length; index += 1) {
      this.offsets.push(this.offset(index) + (this.items[index]?.height ?? 1));
    }
  }

  private indexAt(row: number): number {
    let low = 0;
    let high = this.items.length;

    while (low < high) {
      const middle = Math.floor((low + high) / 2);

      if (this.offset(middle + 1) <= row) low = middle + 1;
      else high = middle;
    }

    return Math.min(low, Math.max(0, this.items.length - 1));
  }

  private anchor(): ReadingAnchor | "bottom" {
    if (this.followMode === "latest") return "bottom";
    const scroll = this.transcript.container;

    if (this.reading?.top === scroll.scrollTop) return this.reading.anchor;

    return this.captureReadingAnchor();
  }

  private captureReadingAnchor(): ReadingAnchor {
    const scroll = this.transcript.container;
    const index = this.indexAt(scroll.scrollTop);
    const row = scroll.scrollTop - this.offset(index);
    const root = this.mounted.get(index)?.root;
    const node = root === undefined ? undefined : this.visibleText(root);

    if (node === undefined) return { index, row };
    const visualRow = Math.max(0, scroll.viewport.y - node.y + node.scrollY);
    // Native line starts are absolute cell offsets, including preceding newlines.
    // CodeRenderable remaps lineSources to markdown source lines, not buffer lines.
    const column = node.lineInfo.lineStartCols[visualRow] ?? 0;
    const text = node.plainText;
    const widthMethod = bufferWidths.get(node) ?? this.transcript.renderer.widthMethod;
    let offset = Math.min(column, text.length);

    if (!/^[\x20-\x7e\n]*$/.test(text)) {
      const buffer = TextBuffer.create(widthMethod);

      try {
        buffer.setText(text);
        offset = buffer.getTextRange(0, column).length;
      } finally {
        buffer.destroy();
      }
    }

    return {
      index,
      row,
      text: {
        node,
        offset: textOffset(node, offset, true),
        widthMethod,
        screenRow: node.y + visualRow - node.scrollY - scroll.viewport.y,
      },
    };
  }

  private visibleText(root: Renderable): TextBufferRenderable | undefined {
    if (!root.visible) return undefined;
    const top = this.transcript.container.viewport.y;

    if (root instanceof TextBufferRenderable && root.y <= top && root.y + root.height > top)
      return root;

    for (const child of root.getChildren()) {
      const node = this.visibleText(child);

      if (node !== undefined) return node;
    }

    return undefined;
  }

  private textTarget(anchor: ReadingAnchor, measured = false): number | undefined {
    const text = anchor.text;

    if (text === undefined || text.node.isDestroyed || !text.node.visible) return undefined;
    const node = text.node;
    const prefix = node.plainText.slice(0, textOffset(node, text.offset, false));
    const column = cellOffset(prefix, prefix.length, text.widthMethod, 4);
    const width = node.getLayoutNode().getComputedLayout().width;
    let info = node.lineInfo;

    // Yoga has measured the new width, but OpenTUI applies text viewports later.
    // Measure only this reading buffer before scroll translation is inherited.
    if (measured && width !== node.width) {
      const buffer = TextBuffer.create(text.widthMethod);
      const view = TextBufferView.create(buffer);

      try {
        buffer.setText(node.plainText);
        view.setWrapMode(node.wrapMode);
        view.setWrapWidth(width);
        info = view.logicalLineInfo;
      } finally {
        view.destroy();
        buffer.destroy();
      }
    }

    const row = info.lineStartCols.findLastIndex((start) => start <= column);
    const scroll = this.transcript.container;

    return (
      scroll.scrollTop +
      (measured ? layoutY(node) - layoutY(scroll.viewport) : node.y - scroll.viewport.y) +
      Math.max(0, row) -
      node.scrollY -
      text.screenRow
    );
  }

  private readonly restoreAnchor = (): void => {
    const anchor = this.pendingAnchor;

    if (anchor === undefined || anchor === "bottom") return;
    const scroll = this.transcript.container;

    const target =
      anchor.text === undefined ? this.indexTarget(anchor) : this.textTarget(anchor, true);

    if (target === undefined) return;
    // Apply the scroll ancestors first. Otherwise viewport resize clamps against
    // the old content height and falsely re-engages the native bottom pin.
    const ancestors: Renderable[] = [];

    for (let node: Renderable | null = scroll.content; node !== null; node = node.parent)
      ancestors.unshift(node);

    for (const node of ancestors) node.updateFromLayout();
    scroll.scrollTo(target);
  };

  /**
   * In-frame, a mounted item's Yoga position beats the prefix offsets: an
   * overscan item mounted above it may have just measured taller than its
   * estimate, which the offsets only learn on the next layout pass.
   */
  private indexTarget(anchor: ReadingAnchor): number {
    const root = this.mounted.get(anchor.index)?.root;

    if (root === undefined || !root.visible) return this.offset(anchor.index) + anchor.row;
    const scroll = this.transcript.container;

    return (
      scroll.scrollTop +
      layoutY(root) -
      layoutY(scroll.viewport) -
      root.getLayoutNode().getComputedMargin(Edge.Top) +
      anchor.row
    );
  }

  private readonly beforeFrame = (): Promise<void> => {
    // Capture against the old geometry before Yoga can clamp a shrinking scroll
    // range or re-engage OpenTUI's bottom pin during reflow.
    if (!this.changingLayout && this.state !== undefined) {
      if (this.followMode === "latest" && !this.atBottom()) this.setFollowMode("history");
      this.pendingAnchor ??= this.anchor();
      this.reconcileWindow();
    }

    return Promise.resolve();
  };

  private readonly scheduleLayout = (): void => {
    if (this.queued || this.transcript.container.isDestroyed) return;
    this.queued = true;
    // FRAME is emitted inside the render pass; mutations there lose render requests.
    queueMicrotask(() => {
      this.queued = false;

      if (!this.transcript.container.isDestroyed && this.state !== undefined) this.layout();
    });
  };

  private layout(): void {
    const scroll = this.transcript.container;

    if (scroll.content.width <= 0 || scroll.viewport.height <= 0) return;
    this.changingLayout = true;

    try {
      const anchor = this.pendingAnchor ?? this.anchor();
      this.pendingAnchor = undefined;
      const geometry = `${String(scroll.content.width)}:${String(this.transcript.userBlockWidth())}:${String(this.transcript.toolOutput.expanded)}`;
      let firstChanged = this.items.length;

      if (geometry !== this.geometry) {
        this.geometry = geometry;

        for (const [index, item] of this.items.entries()) {
          const cached = this.heights.get(
            `${geometry}:${item.messageId}:${String(item.disclosures.revision)}`,
          );

          // A different width is an estimate until this item is mounted and measured.
          if (cached?.source === item.source && cached.height !== item.height) {
            item.height = cached.height;
            firstChanged = Math.min(firstChanged, index);
          }
        }
      }

      for (const [index, mounted] of this.mounted) {
        const item = this.items[index];

        // A root just mounted outside a frame reads 0 until Yoga measures it;
        // its estimate must stand or every offset below it shifts for one frame.
        if (item === undefined || mounted.root.height === 0) continue;
        const height = mounted.root.height + SPACING.block;

        if (item.height !== height) {
          item.height = height;
          firstChanged = Math.min(firstChanged, index);
        }

        const key = `${geometry}:${item.messageId}:${String(item.disclosures.revision)}`;
        this.heights.delete(key);
        this.heights.set(key, { source: item.source, height });
      }

      while (this.heights.size > HEIGHT_CACHE_LIMIT) {
        const oldest = this.heights.keys().next();

        if (oldest.done) break;
        this.heights.delete(oldest.value);
      }

      // A growing live tail changes just the final offset, not the history prefix.
      if (firstChanged < this.items.length) this.reindex(firstChanged);

      if (this.navigationKey !== undefined) {
        const navigationIndex = this.items.findIndex(
          (item) => item.messageId === this.navigationKey,
        );

        if (navigationIndex === -1) this.endNavigation();
        else
          this.setNavigationSlack(
            this.slackForTarget(this.offset(navigationIndex) + SPACING.block),
          );
      }

      // Rebase before deciding the window, otherwise newly measured overscan can
      // evict the very turn the reader was looking at.
      const target =
        anchor === "bottom"
          ? undefined
          : (this.textTarget(anchor) ?? this.offset(anchor.index) + anchor.row);

      this.reconcileWindow(
        target ?? Math.max(0, this.offset(this.items.length) - scroll.viewport.height),
      );

      if (anchor === "bottom") scroll.scrollTo(Infinity);
      else if (target !== undefined && target !== scroll.scrollTop) scroll.scrollTo(target);
      // beforeFrame re-reads this anchor, so a clamped target is retried before the next frame.
      this.reading = { top: scroll.scrollTop, anchor };
    } finally {
      this.changingLayout = false;
    }
  }

  private reconcileWindow(top = this.transcript.container.scrollTop): void {
    const scroll = this.transcript.container;
    const viewport = this.viewportRows();
    const atBottom = this.pendingAnchor === "bottom";
    const position = atBottom ? Math.max(0, this.offset(this.items.length) - viewport) : top;
    const start = this.indexAt(Math.max(0, position - viewport));
    const end = this.indexAt(position + viewport * 2);
    const selection = this.transcript.renderer.getSelection();

    if (
      selection !== null &&
      (selection.isDragging || !selection.isStart || selection.behavior !== "cell")
    ) {
      const retained =
        this.selectionRange?.selection === selection ? this.selectionRange : undefined;

      this.selectionRange = {
        selection,
        start: selection.isDragging
          ? Math.min(start, retained?.start ?? start)
          : (retained?.start ?? start),
        end: selection.isDragging ? Math.max(end, retained?.end ?? end) : (retained?.end ?? end),
      };
    } else this.selectionRange = undefined;
    const keep = new Set<number>();

    for (let index = start; index <= end && index < this.items.length; index += 1) keep.add(index);

    if (this.selectionRange !== undefined) {
      for (
        let index = this.selectionRange.start;
        index <= this.selectionRange.end && index < this.items.length;
        index += 1
      )
        keep.add(index);
    }

    if (this.items.length > 0) keep.add(this.items.length - 1);

    if (this.lastTurnIndex >= 0) keep.add(this.lastTurnIndex);

    for (const [index, mounted] of this.mounted) {
      if (keep.has(index) || mounted.root.hasFocusedDescendant) continue;
      mounted.root.parent?.remove(mounted.root);
      mounted.root.destroyRecursively();
      this.mounted.delete(index);
    }

    const owner = this.transcript;

    for (const index of keep) {
      if (this.mounted.has(index)) continue;
      const item = this.items[index];

      if (item === undefined) continue;

      const transcript: Transcript = {
        ...this.transcript,
        disclosures: item.disclosures,
        tasks: () => owner.tasks(),
        get syntaxStyle() {
          return owner.syntaxStyle;
        },
        get subtleSyntaxStyle() {
          return owner.subtleSyntaxStyle;
        },
      };

      const mounted: MountedItem =
        item.item.kind === "turn"
          ? (() => {
              const block = new TurnBlock(transcript, item.item.id, item.item.durationMs);

              return { kind: "turn", root: block.root, block };
            })()
          : item.item.kind === "shell"
            ? (() => {
                const root = new BoxRenderable(transcript.renderer, {
                  id: transcript.nextId("shell"),
                  flexDirection: "column",
                  width: "100%",
                  live: false,
                });

                const card = new ToolCard(
                  transcript,
                  item.item.execution,
                  root,
                  undefined,
                  undefined,
                  false,
                  item.item.note,
                );

                return { kind: "shell", root, card };
              })()
            : { kind: "marker", root: appendMarker(transcript, markerProps(item.item)) };

      this.mounted.set(index, mounted);
      this.syncMounted(index, mounted);
    }

    const children: Renderable[] = [];
    let cursor = 0;
    let gaps = 0;

    for (const [index, mounted] of [...this.mounted].toSorted(
      (left, right) => left[0] - right[0],
    )) {
      if (index > cursor) {
        let spacer = this.spacers[gaps];

        if (spacer === undefined) {
          spacer = new BoxRenderable(this.transcript.renderer, {
            id: this.transcript.nextId("transcript-spacer"),
            width: "100%",
            height: 0,
            flexShrink: 0,
          });
          this.spacers.push(spacer);
        }

        // The getter reads the last layout, so it cannot dedupe a request; the setter does.
        spacer.height = this.offset(index) - this.offset(cursor);
        children.push(spacer);
        gaps += 1;
      }

      children.push(mounted.root);
      cursor = index + 1;
    }

    for (const spacer of this.spacers.splice(gaps)) {
      spacer.parent?.remove(spacer);
      spacer.destroy();
    }

    if (this.liveTurn !== undefined) children.push(this.liveTurn.block.root);

    if (this.tail !== undefined) children.push(this.tail);
    children.push(this.navigationSpacer);
    const current = scroll.getChildren();

    if (
      current.length === children.length &&
      children.every((child, index) => current[index] === child)
    )
      return;

    // add moves existing children, so changed orders must read back each mutation.
    for (const [index, child] of children.entries()) {
      if (scroll.getChildren()[index] !== child) scroll.add(child, index);
    }
  }
}
