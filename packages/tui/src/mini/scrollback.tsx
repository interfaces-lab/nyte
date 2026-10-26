import { MarkdownRenderable } from "@opentui/core";
import type { CliRenderer, ScrollbackSurface, SyntaxStyle } from "@opentui/core";
import { writeSolidToScrollback } from "@opentui/solid";
import { createEffect, createRoot } from "solid-js";
import type { Kit } from "../app/context.tsx";
import { syntaxStyle } from "../app/kit.ts";
import type { Store } from "../app/store.ts";
import { followedSession } from "../model/state.ts";
import { ENTRY_INSET, EntryView } from "./entry.tsx";
import { gapBefore, noteEntry, projectMiniTranscript } from "./transcript.ts";
import type { MiniEntry } from "./transcript.ts";

type Answer = Extract<MiniEntry, { readonly kind: "answer" }>;

/** An answer drawn into scrollback a block at a time, on one surface kept for its whole stream. */
interface Streaming {
  readonly key: string;
  readonly surface: ScrollbackSurface;
  readonly body: MarkdownRenderable;
  readonly style: SyntaxStyle;
  committed: number;
}

/**
 * Writes the minimal transcript into the terminal's scrollback as it settles. An answer streams
 * in as its markdown blocks stop changing; every other entry is written once, whole. Writes go
 * through one queue so they land in transcript order, and the variables above the queue track
 * what has been asked for so far, ahead of what the queue has done.
 */
export function installMiniScrollback(options: {
  readonly renderer: CliRenderer;
  readonly store: Pick<Store, "state" | "screen">;
  readonly kit: Kit;
}) {
  const renderer = options.renderer;
  const store = options.store;
  const kit = options.kit;
  const emitted = new Set<string>();
  let session: string | null = null;
  let tail: string | null = null;
  let previous: MiniEntry | null = null;
  let open: { readonly key: string; markdown: string } | null = null;
  let flushing: string | null = null;
  let streaming: Streaming | null = null;
  let stopped = false;
  let pending = Promise.resolve();

  const enqueue = (task: () => Promise<void> | void): void => {
    pending = pending
      .then(async () => {
        if (!stopped) await task();
      })
      .catch((cause: unknown) => {
        if (stopped) return;
        stopped = true;
        kit.report("render", cause);
      });
  };

  const start = (entry: Answer, gap: boolean): void => {
    const surface = renderer.createScrollbackSurface();
    const style = syntaxStyle(kit.theme(), false, surface.renderContext.nativeScene);

    const body = new MarkdownRenderable(surface.renderContext, {
      marginLeft: ENTRY_INSET,
      marginRight: ENTRY_INSET,
      marginTop: gap ? 1 : 0,
      content: "",
      syntaxStyle: style,
      fg: kit.theme().foreground,
      streaming: true,
      internalBlockMode: "top-level",
    });

    surface.root.add(body);
    streaming = { key: entry.key, surface, body, style, committed: 0 };
  };

  const commit = async (current: Streaming, markdown: string, done: boolean): Promise<void> => {
    current.body.content = markdown;
    current.body.streaming = !done;
    await current.surface.settle();

    if (stopped) return;
    current.surface.render();
    const end = done ? current.surface.height : settledRows(current.body);

    if (end <= current.committed) return;
    current.surface.commitRows(current.committed, end, { trailingNewline: true });
    current.committed = end;
  };

  const finish = async (markdown: string): Promise<void> => {
    const current = streaming;
    streaming = null;

    if (current === null) return;

    try {
      await commit(current, markdown, true);
    } finally {
      current.surface.destroy();
      current.style.destroy();
    }
  };

  const closeOpen = (markdown?: string): void => {
    if (open === null) return;
    const text = markdown ?? open.markdown;
    open = null;
    enqueue(() => finish(text));
  };

  const stream = (entry: Answer): void => {
    if (open?.key !== entry.key) {
      closeOpen();
      const gap = gapBefore(previous, entry);
      previous = entry;
      enqueue(() => start(entry, gap));
      open = { key: entry.key, markdown: entry.markdown };
    }

    open.markdown = entry.markdown;

    if (flushing === entry.key) return;
    flushing = entry.key;

    enqueue(async () => {
      if (flushing === entry.key) flushing = null;
      const current = streaming;

      if (current === null || open === null || current.key !== open.key) return;
      await commit(current, open.markdown, false);
    });
  };

  const write = (entry: MiniEntry): void => {
    if (entry.kind === "answer" && open?.key === entry.key) {
      closeOpen(entry.markdown);

      return;
    }

    closeOpen();
    const gap = gapBefore(previous, entry);
    previous = entry;

    if (entry.kind === "answer") {
      enqueue(() => start(entry, gap));
      enqueue(() => finish(entry.markdown));

      return;
    }

    enqueue(() =>
      writeSolidToScrollback(
        renderer,
        () => <EntryView entry={entry} gap={gap} theme={kit.theme()} />,
        { trailingNewline: true },
      ),
    );
  };

  const disposeWatch = createRoot((dispose) => {
    createEffect(() => {
      const state = store.state();
      const chat = state.facts.chat;

      if (chat === null) return;
      const screen = store.screen();
      const plan = projectMiniTranscript(screen.transcript, screen.tasks);
      const view = followedSession(state)?.view ?? null;
      const changedSession = session !== null && session !== chat.id;

      const changedPosition =
        session === chat.id && view !== null && tail !== null && !plan.path.includes(tail);

      if (changedSession || changedPosition) {
        write(
          noteEntry("position", changedSession ? "── New chat ──" : "── Chat position changed ──"),
        );
        emitted.clear();
        tail = null;
      }

      session = chat.id;

      if (view !== null) tail = plan.path.at(-1) ?? tail;

      const first = plan.ready.findLastIndex((entry) => emitted.has(entry.key)) + 1;

      for (const entry of plan.ready.slice(first)) {
        if (emitted.has(entry.key)) continue;
        emitted.add(entry.key);
        write(entry);
      }

      const next = plan.held[0];

      if (next?.kind === "answer" && !emitted.has(next.key)) stream(next);
    });

    return dispose;
  });

  return {
    async close() {
      disposeWatch();
      const screen = store.screen();
      const plan = projectMiniTranscript(screen.transcript, screen.tasks);

      for (const entry of plan.held) if (!emitted.has(entry.key)) write(entry);
      closeOpen();

      if (
        plan.status !== null &&
        plan.status.kind !== "settled" &&
        plan.status.kind !== "unanswered"
      )
        write(noteEntry("unfinished", "Turn unfinished"));
      await pending;
      stopped = true;
    },
    dispose() {
      disposeWatch();
      stopped = true;
      streaming?.surface.destroy();
      streaming?.style.destroy();
      streaming = null;
    },
  };
}

/**
 * The rows down to the bottom of the last markdown block that will not change as more streams
 * in. OpenTUI exposes block layout only through these underscored fields; OpenCode's mini mode
 * reads them the same way.
 */
function settledRows(body: MarkdownRenderable): number {
  // oxlint-disable-next-line no-underscore-dangle -- the only view of the parsed blocks
  const blocks = body._blockStates;
  // oxlint-disable-next-line no-underscore-dangle -- the only view of which blocks are final
  const last = blocks[body._stableBlockCount - 1];

  return last === undefined ? 0 : last.renderable.y + last.renderable.height;
}
