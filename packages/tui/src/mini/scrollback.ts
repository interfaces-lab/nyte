import { MarkdownRenderable, TextRenderable } from "@opentui/core";
import type { CliRenderer, ScrollbackSurface } from "@opentui/core";
import { createEffect, createRoot } from "solid-js";
import type { Kit } from "../app/context.tsx";
import { syntaxStyle } from "../app/kit.ts";
import type { Store } from "../app/store.ts";
import { followedSession } from "../model/state.ts";
import { projectMiniTranscript } from "./transcript.ts";
import type { MiniEntry } from "./transcript.ts";

export function installMiniScrollback(options: {
  readonly renderer: CliRenderer;
  readonly store: Pick<Store, "state" | "screen">;
  readonly kit: Kit;
}) {
  const { renderer, store, kit } = options;
  const emitted = new Set<string>();
  let session: string | null = null;
  let tail: string | null = null;
  let stopped = false;
  let surface: ScrollbackSurface | null = null;
  let pending = Promise.resolve();

  const write = async (entry: MiniEntry): Promise<void> => {
    if (stopped) return;
    const drawing = renderer.createScrollbackSurface();
    surface = drawing;
    const style = syntaxStyle(kit.theme(), false, drawing.renderContext.nativeScene);
    const layout = { marginLeft: 2, marginRight: 2, marginBottom: entry.style === "tool" ? 0 : 1 };

    const body =
      entry.style === "answer"
        ? new MarkdownRenderable(drawing.renderContext, {
            ...layout,
            content: entry.content,
            syntaxStyle: style,
            fg: kit.theme().foreground,
          })
        : new TextRenderable(drawing.renderContext, {
            ...layout,
            content: entry.content,
            fg: kit.theme()[entry.style],
            wrapMode: "word",
          });

    try {
      drawing.root.add(body);
      await drawing.settle();

      if (stopped) return;
      drawing.render();
      drawing.commitRows(0, drawing.height, { trailingNewline: true });
    } finally {
      body.destroyRecursively();
      style.destroy();
      drawing.destroy();
      surface = null;
    }
  };

  const append = (entry: MiniEntry): void => {
    pending = pending
      .then(() => write(entry))
      .catch((cause: unknown) => {
        if (stopped) return;
        stopped = true;
        kit.report("render", cause);
      });
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
        append({
          key: "position",
          content: changedSession ? "── New chat ──" : "── Chat position changed ──",
          style: "dim",
        });
        emitted.clear();
        tail = null;
      }

      session = chat.id;

      if (view !== null) tail = plan.path.at(-1) ?? tail;

      const start = plan.ready.findLastIndex((entry) => emitted.has(entry.key)) + 1;

      for (const entry of plan.ready.slice(start)) {
        if (emitted.has(entry.key)) continue;
        emitted.add(entry.key);
        append(entry);
      }
    });

    return dispose;
  });

  return {
    async close() {
      disposeWatch();
      const screen = store.screen();
      const plan = projectMiniTranscript(screen.transcript, screen.tasks);

      for (const entry of plan.live) append(entry);

      if (
        plan.status !== null &&
        plan.status.kind !== "settled" &&
        plan.status.kind !== "unanswered"
      )
        append({ key: "unfinished", content: "Turn unfinished", style: "dim" });
      await pending;
      stopped = true;
    },
    dispose() {
      disposeWatch();
      stopped = true;
      surface?.destroy();
    },
  };
}
