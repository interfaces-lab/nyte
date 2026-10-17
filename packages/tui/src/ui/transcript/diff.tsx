import {
  CodeRenderable,
  DiffRenderable,
  LineNumberRenderable,
  pathToFiletype,
} from "@opentui/core";
import type { SimpleHighlight } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { diffWordsWithSpace } from "diff";
import { createEffect, For, on, onCleanup, Show } from "solid-js";
import { useApp } from "../../app/context.tsx";
import { unchangedLinesLabel } from "../../lib/format.ts";
import type { ChangedLinePair, OutputDiff } from "../../lib/output-diff.ts";
import { displayWidth } from "../../lib/width.ts";

const WORD_SPAN_LIMIT = 4_000;

function wordSpans(content: string, pair: ChangedLinePair): SimpleHighlight[] {
  if (pair.removed.length + pair.added.length > WORD_SPAN_LIMIT) return [];
  const rows = content.split("\n");

  if (rows[pair.row] !== pair.removed || rows[pair.row + 1] !== pair.added) return [];
  const removedStart = rows.slice(0, pair.row).reduce((sum, row) => sum + row.length + 1, 0);
  const addedStart = removedStart + pair.removed.length + 1;
  const spans: SimpleHighlight[] = [];
  let removedOffset = removedStart;
  let addedOffset = addedStart;

  for (const change of diffWordsWithSpace(pair.removed, pair.added)) {
    const offset = change.added ? addedOffset : removedOffset;

    if (change.added || change.removed) {
      const leading = change.value.length - change.value.trimStart().length;
      const trailing = change.value.length - change.value.trimEnd().length;

      if (leading + trailing < change.value.length)
        spans.push([
          offset + leading,
          offset + change.value.length - trailing,
          change.added ? "diff.plus" : "diff.minus",
        ]);
    }

    if (!change.added) removedOffset += change.value.length;

    if (!change.removed) addedOffset += change.value.length;
  }

  return spans;
}

function markChangedWords(diff: DiffRenderable, pair: ChangedLinePair): void {
  const code = diff
    .getChildren()
    .filter((child) => child instanceof LineNumberRenderable)
    .flatMap((gutter) => gutter.getChildren())
    .find((child) => child instanceof CodeRenderable);

  if (code === undefined) return;
  code.onHighlight = (highlights, context) => [...highlights, ...wordSpans(context.content, pair)];
}

function syncDiffGutters(diffs: readonly DiffRenderable[]): void {
  const gutters = diffs.flatMap((diff) =>
    diff.getChildren().filter((child) => child instanceof LineNumberRenderable),
  );

  const numbers = gutters.map((gutter) => new Map(gutter.getLineNumbers()));
  const digits = numbers.map((lines) => Math.max(0, ...lines.values()).toString().length);

  const after = gutters.map((gutter) =>
    Math.max(
      0,
      ...[...gutter.getLineSigns().values()].map((sign) => displayWidth(sign.after ?? "")),
    ),
  );

  const maxDigits = Math.max(0, ...digits);
  const maxAfter = Math.max(0, ...after);

  for (const [index, gutter] of gutters.entries()) {
    const lineNumbers = numbers[index];
    const lineDigits = digits[index];

    if (lineNumbers === undefined || lineDigits === undefined) continue;
    const signs = new Map(gutter.getLineSigns());
    signs.set(-1, { after: " ".repeat(maxAfter + maxDigits - lineDigits) });
    gutter.setLineNumbers(lineNumbers);
    gutter.setLineSigns(signs);
  }
}

export function DiffView(props: { readonly diff: OutputDiff }): JSX.Element {
  const { kit } = useApp();
  const theme = (): ReturnType<typeof kit.theme> => kit.theme();
  const mounted = new Set<DiffRenderable>();

  createEffect(
    on(
      () => props.diff,
      () => syncDiffGutters([...mounted]),
    ),
  );

  return (
    <For each={props.diff.files}>
      {(file) => (
        <For each={file.sections}>
          {(hunk) => (
            <>
              <Show when={hunk.omittedBefore > 0}>
                <text fg={theme().dim} selectable={false}>
                  {unchangedLinesLabel(hunk.omittedBefore)}
                </text>
              </Show>
              <diff
                ref={(node: DiffRenderable) => {
                  mounted.add(node);
                  onCleanup(() => mounted.delete(node));

                  if (hunk.pair !== undefined) markChangedWords(node, hunk.pair);
                }}
                diff={hunk.patch}
                view="unified"
                showLineNumbers
                filetype={
                  (file.path === undefined ? undefined : pathToFiletype(file.path)) ??
                  (hunk.pair === undefined ? undefined : "text")
                }
                syntaxStyle={kit.syntax().normal}
                wrapMode="none"
                fg={theme().foreground}
                addedBg={theme().diffAddedBackground}
                removedBg={theme().diffRemovedBackground}
                addedLineNumberBg={theme().diffAddedGutterBackground}
                removedLineNumberBg={theme().diffRemovedGutterBackground}
                addedSignColor={theme().diffAdded}
                removedSignColor={theme().diffRemoved}
                lineNumberFg={theme().dim}
                selectionBg={theme().selectionBackground}
                selectionFg={theme().selectionForeground}
                minHeight={hunk.rows > 0 ? hunk.rows : undefined}
                width="100%"
              />
            </>
          )}
        </For>
      )}
    </For>
  );
}
