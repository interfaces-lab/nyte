import { parseDiffFromFile } from "@pierre/diffs";
import { create, props } from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import type { ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { floatingSurfaceStyles } from "@nyte-ai/ui/styles/floating-surface.stylex";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { nyte } from "../../contract/nyte.ts";
import { useHostState } from "../../data/host.ts";
import { gitFor } from "../../data/vcs.ts";
import { useWatch } from "../../data/watch-store.ts";
import { gitStatusWatch } from "../../data/watches.ts";
import { changeBarCss, lineChanges } from "./line-changes.ts";
import type { LineChange } from "./line-changes.ts";

export function useLineChanges(input: {
  readonly path: string;
  readonly relative: string;
  readonly contents: string;
  readonly enabled: boolean;
  readonly line: number;
  readonly reveal: (line: number) => void;
}) {
  const workspace = useHostState().data.workspace?.id;

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

  const base = committed.data?.old;
  const compared = useDeferredValue(input.contents);

  const [opened, setOpened] = useState<{
    readonly head: typeof head;
    readonly contents: string;
    readonly index: number;
  }>();

  const comparison =
    input.enabled && head !== undefined && (base?.kind === "text" || base?.kind === "absent")
      ? {
          contents: compared,
          changes: lineChanges(
            parseDiffFromFile(
              { name: input.path, contents: base.kind === "text" ? base.text : "" },
              { name: input.path, contents: compared },
            ),
          ),
        }
      : undefined;

  const exact = comparison?.contents === input.contents ? comparison : undefined;

  const peekIndex =
    exact !== undefined &&
    opened !== undefined &&
    opened.head === head &&
    opened.contents === exact.contents
      ? opened.index
      : undefined;

  const peeked = peekIndex === undefined ? undefined : exact?.changes[peekIndex];

  const step = (delta: 1 | -1): void => {
    if (exact === undefined || exact.changes.length === 0) return;
    const changes = exact.changes;

    const from =
      peekIndex ??
      (delta === 1
        ? changes.findIndex((change) => change.start > input.line) - 1
        : changes.findLastIndex((change) => change.start < input.line) + 1);

    const next = (from + delta + changes.length) % changes.length;
    setOpened({ head, contents: exact.contents, index: next });
    input.reveal(Math.max(1, changes[next]?.start ?? 1));
  };

  return {
    css: changeBarCss(comparison?.changes ?? []),
    peek:
      peeked === undefined || peekIndex === undefined || exact === undefined
        ? undefined
        : { change: peeked, index: peekIndex, count: exact.changes.length },
    step,
    close: () => setOpened(undefined),
    peekAt: (line: number): void => {
      if (exact === undefined) return;
      const index = findChangeAt(exact.changes, line);

      setOpened(index === -1 ? undefined : { head, contents: exact.contents, index });
    },
  };
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
  onStep,
  onRevert,
  onClose,
}: {
  readonly change: LineChange;
  readonly index: number;
  readonly count: number;
  readonly onStep: (delta: 1 | -1) => void;
  readonly onRevert: () => void;
  readonly onClose: () => void;
}): ReactElement {
  const mac = nyte.platform === "darwin";

  return (
    <section
      aria-label={`Change ${String(index + 1)} of ${String(count)}`}
      {...props(floatingSurfaceStyles.popup, styles.root)}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
    >
      <div {...props(styles.header)}>
        <span {...props(text.sm, styles.title)}>
          {change.kind === "added" ? "Added" : change.kind === "deleted" ? "Deleted" : "Changed"}{" "}
          line {change.start} · {index + 1} of {count}
        </span>
        <Button
          size="2xs"
          iconOnly
          icon="arrow-up"
          aria-label="Previous Change"
          title={`Previous Change (${mac ? "⇧⌥F3" : "Shift+Alt+F3"})`}
          disabled={count < 2}
          onClick={() => onStep(-1)}
        />
        <Button
          size="2xs"
          iconOnly
          icon="arrow-down"
          aria-label="Next Change"
          title={`Next Change (${mac ? "⌥F3" : "Alt+F3"})`}
          disabled={count < 2}
          onClick={() => onStep(1)}
        />
        <Button size="2xs" onClick={onRevert}>
          Revert
        </Button>
        <Button size="2xs" iconOnly icon="x" aria-label="Close" onClick={onClose} />
      </div>
      <pre {...props(text.code, styles.lines)}>
        {change.removed.map((line, offset) => (
          <span key={`-${String(offset)}`} {...props(surfaceTheme.red, styles.line, styles.tint)}>
            {`- ${line}`}
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
    position: "absolute",
    insetBlockStart: space.s2,
    insetInlineEnd: space.s4,
    zIndex: 2,
    display: "flex",
    flexDirection: "column",
    width: "min(520px, calc(100% - 32px))",
    maxHeight: "50%",
    borderRadius: radius.control,
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: space.s1,
    paddingBlock: space.s1,
    paddingInline: space.s2,
  },
  title: { flex: 1, minWidth: 0, color: role.contentSecondary },
  lines: {
    margin: 0,
    overflow: "auto",
    paddingBlock: space.s1,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
  },
  line: { display: "block", paddingInline: space.s2, whiteSpace: "pre" },
  tint: { backgroundColor: role.bgMutedTranslucent, color: role.contentAccent },
});
