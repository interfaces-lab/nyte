import { parseDiffFromFile, parsePatchFiles } from "@nyte-ai/ui/diffs";
import type { CodeViewHandle } from "@nyte-ai/ui/diffs/react";
import { create, props } from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useLayoutEffect, useState } from "react";
import type { ReactElement, RefObject } from "react";
import type { WorkspaceId } from "@nyte-ai/sdk";
import { Button } from "@nyte-ai/ui/button";
import { hairline } from "@nyte-ai/ui/styles/hairline.stylex";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { nyte } from "../../contract/nyte.ts";
import { gitFor } from "../../data/vcs.ts";
import { useWatch } from "../../data/watch-store.ts";
import { gitStatusWatch } from "../../data/watches.ts";
import { useChatChanges } from "./chat-changes.ts";
import { lineChanges, textBefore } from "./line-changes.ts";
import type { LineChange } from "./line-changes.ts";

export function useLineChanges(input: {
  readonly workspace: WorkspaceId | undefined;
  readonly path: string;
  readonly relative: string;
  readonly contents: string;
  readonly saved: string;
  readonly enabled: boolean;
  readonly caretLine: () => number;
  readonly reveal: (line: number) => void;
  readonly viewer: RefObject<CodeViewHandle<undefined, undefined> | null>;
}) {
  const workspace = input.workspace;

  const status = useWatch(
    input.enabled && workspace !== undefined ? gitStatusWatch(workspace) : undefined,
  ).value;

  const head = status?.kind === "repository" ? status.head : undefined;

  const committed = useQuery({
    queryKey: ["files", "committed", input.path, head],
    queryFn: async () => (await gitFor(workspace)).contents(input.relative, { kind: "worktree" }),
    enabled: input.enabled && head !== undefined,
    staleTime: Infinity,
  });

  const patches = useChatChanges(status?.kind === "none" ? workspace : undefined, (edits) =>
    edits
      ?.find((edit) => edit.path === input.relative || edit.path === input.path)
      ?.patches.map((made) => made.patch),
  );

  const committedSide = committed.data?.old;

  const chatBase = useChatBase(head === undefined ? patches : undefined, input.saved);

  const base =
    head !== undefined
      ? committedSide?.kind === "text"
        ? committedSide.text
        : committedSide?.kind === "absent"
          ? ""
          : undefined
      : chatBase;

  const basis = head !== undefined ? head : patches;
  const compared = useDeferredValue(input.contents);

  const [opened, setOpened] = useState<{
    readonly basis: typeof basis;
    readonly contents: string;
    readonly index: number;
  }>();

  const comparison = useComparison(input.path, input.enabled ? base : undefined, compared);

  const exact = comparison?.contents === input.contents ? comparison : undefined;

  const peekIndex =
    exact !== undefined &&
    opened !== undefined &&
    opened.basis === basis &&
    opened.contents === exact.contents
      ? opened.index
      : undefined;

  const peeked = peekIndex === undefined ? undefined : exact?.changes[peekIndex];

  const below =
    peeked === undefined
      ? undefined
      : peeked.kind === "deleted"
        ? peeked.start - 1
        : peeked.start + peeked.added.length - 1;

  // oxlint-disable-next-line nyte-code/no-direct-effect -- places the open peek under its change in the imperative viewer before paint
  useLayoutEffect(() => {
    const viewer = input.viewer.current;
    const item = viewer?.getItem(input.path);

    if (viewer === null || item?.type !== "file") return;
    viewer.updateItem({
      ...item,
      annotations: below === undefined ? [] : [{ lineNumber: below }],
      version: (item.version ?? 0) + 1,
    });
  }, [below, input.path, input.viewer]);

  const step = (delta: 1 | -1): void => {
    if (exact === undefined || exact.changes.length === 0) return;
    const changes = exact.changes;

    const from =
      peekIndex ??
      (delta === 1
        ? changes.findIndex((change) => change.start > input.caretLine()) - 1
        : changes.findLastIndex((change) => change.start < input.caretLine()) + 1);

    const next = (from + delta + changes.length) % changes.length;
    setOpened({ basis, contents: exact.contents, index: next });
    input.reveal(Math.max(1, changes[next]?.start ?? 1));
  };

  return {
    changes: comparison?.changes,
    peekLine: below,
    peek:
      peeked === undefined || peekIndex === undefined || exact === undefined
        ? undefined
        : {
            change: peeked,
            index: peekIndex,
            count: exact.changes.length,
            label: head === undefined ? "Chat Edits" : "Uncommitted",
          },
    step,
    close: (): void => {
      setOpened(undefined);
      input.viewer.current?.getEditor(input.path)?.focus();
    },
    peekAt: (line: number): void => {
      if (exact === undefined) return;
      const index = findChangeAt(exact.changes, line);

      setOpened(index === -1 ? undefined : { basis, contents: exact.contents, index });
    },
  };
}

function useChatBase(patches: readonly string[] | undefined, saved: string): string | undefined {
  const [undo] = useState(() => lastResult(undoEdits));

  return patches === undefined ? undefined : undo(patches, saved);
}

function useComparison(path: string, base: string | undefined, compared: string) {
  const [compare] = useState(() =>
    lastResult((name: string, before: string, after: string) => ({
      contents: after,
      changes: lineChanges(
        parseDiffFromFile({ name, contents: before }, { name, contents: after }),
      ),
    })),
  );

  return base === undefined ? undefined : compare(path, base, compared);
}

function lastResult<Arguments extends readonly unknown[], Result>(
  run: (...input: Arguments) => Result,
): (...input: Arguments) => Result {
  let last: { readonly input: Arguments; readonly result: Result } | undefined;

  return (...input) => {
    if (
      last !== undefined &&
      last.input.length === input.length &&
      last.input.every((value, index) => value === input[index])
    )
      return last.result;
    const result = run(...input);
    last = { input, result };

    return result;
  };
}

function undoEdits(patches: readonly string[], text: string): string {
  const newest = patches[0];
  const diff = newest === undefined ? undefined : parsePatchFiles(newest)[0]?.files[0];
  const before = diff === undefined ? undefined : textBefore(diff, text);

  return before === undefined ? text : undoEdits(patches.slice(1), before);
}

function findChangeAt(changes: readonly LineChange[], line: number): number {
  const containing = changes.findIndex(
    (change) =>
      change.kind !== "deleted" &&
      line >= change.start &&
      line < change.start + change.added.length,
  );

  if (containing !== -1) return containing;

  return changes.findIndex(
    (change) => change.kind === "deleted" && line === Math.max(1, change.start - 1),
  );
}

export function ChangePeek({
  change,
  index,
  count,
  label,
  onStep,
  onRevert,
  onClose,
}: {
  readonly change: LineChange;
  readonly index: number;
  readonly count: number;
  readonly label: string;
  readonly onStep: (delta: 1 | -1) => void;
  readonly onRevert: () => void;
  readonly onClose: () => void;
}): ReactElement {
  const mac = nyte.platform === "darwin";

  return (
    <section
      aria-label={`Change ${String(index + 1)} of ${String(count)}`}
      {...props(styles.root, hairline.controlRing)}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
    >
      <div {...props(styles.header)}>
        <span {...props(text.sm, styles.title)}>
          {label}{" "}
          <span {...props(styles.count)}>
            · {index + 1} of {count}
          </span>
        </span>
        <Button
          size="2xs"
          iconOnly
          icon="arrow-up"
          aria-label="Previous change"
          title={`Previous change (${mac ? "⇧⌥F3" : "Shift+Alt+F3"})`}
          disabled={count < 2}
          onClick={() => onStep(-1)}
        />
        <Button
          size="2xs"
          iconOnly
          icon="arrow-down"
          aria-label="Next change"
          title={`Next change (${mac ? "⌥F3" : "Alt+F3"})`}
          disabled={count < 2}
          onClick={() => onStep(1)}
        />
        <Button size="2xs" onClick={onRevert}>
          Revert
        </Button>
        <Button size="2xs" iconOnly icon="x" aria-label="Close change peek" onClick={onClose} />
      </div>
      <pre {...props(text.code, styles.lines)}>
        {change.removed.map((line, offset) => (
          <span key={`-${String(offset)}`} {...props(surfaceTheme.red, styles.line, styles.tint)}>
            {`− ${line}`}
          </span>
        ))}
        {change.added.map((line, offset) => (
          <span key={`+${String(offset)}`} {...props(surfaceTheme.green, styles.line, styles.tint)}>
            {`+ ${line}`}
          </span>
        ))}
      </pre>
    </section>
  );
}

const styles = create({
  root: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    marginInlineEnd: space.s3,
    borderRadius: radius.control,
    overflow: "hidden",
    backgroundColor: role.bgElevated,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: space.s1,
    paddingBlock: space.s1,
    paddingInline: space.s2,
  },
  title: { flex: 1, minWidth: 0, color: role.contentSecondary },
  count: { color: role.contentTertiary },
  lines: {
    margin: 0,
    overflow: "auto",
    maxBlockSize: `calc(${type.leadingCode} * 16)`,
    paddingBlock: space.s1,
  },
  line: { display: "block", paddingInline: space.s2, whiteSpace: "pre" },
  tint: { backgroundColor: role.bgMutedTranslucent, color: role.contentAccent },
});
