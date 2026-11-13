import { create, props } from "@stylexjs/stylex";
import { useMutation } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { taskEnded } from "@nyte-ai/plugin/client/presentation";
import type { TaskState } from "@nyte-ai/plugin/client/presentation";
import type { SessionId } from "@nyte-ai/sdk";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import type { IconName } from "@nyte-ai/ui/icon";
import { Row } from "@nyte-ai/ui/row";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { button, control, glyph, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import type { Task } from "../../chats/index.ts";
import { TaskMark } from "../../components/task-mark.tsx";
import { tray } from "../../theme/schema.stylex.ts";
import { chatWindow, useChatWindow } from "../../window/index.ts";

const BULK_MIN = 2;

const SETTLE = { type: "spring", duration: 0.3, bounce: 0 } as const;

const FADE = { duration: 0.15 } as const;

const SWAP = { type: "spring", duration: 0.25, bounce: 0 } as const;

const styles = create({
  scroll: (maxHeight: number) => ({
    flexShrink: 1,
    minWidth: 0,
    minHeight: 0,
    maxHeight: Math.min(260, maxHeight),
    overflowY: "auto",
    overscrollBehavior: "contain",
  }),
  list: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: space.px,
    minWidth: 0,
    paddingBlock: tray.rowInset,
    paddingInline: tray.rowInset,
  },
  row: {
    minHeight: tray.rowHeight,
    "--_row-padding-inline": `calc(${tray.paddingInline} - ${tray.rowInset})`,
  },
  rowActions: { marginInlineEnd: `calc(${space.s0_5} + ${tray.rowInset} - ${tray.paddingInline})` },
  secondary: { color: role.contentSecondary },
  section: {
    display: "flex",
    alignItems: "center",
    gap: space.s1_5,
    minHeight: tray.rowHeight,
    paddingInlineStart: `calc(${tray.paddingInline} - ${tray.rowInset})`,
    paddingInlineEnd: space.s0_5,
    color: role.contentTertiary,
  },
  later: { marginBlockStart: space.s1 },
  count: { fontVariantNumeric: "tabular-nums" },
  sectionAction: {
    display: "flex",
    marginInlineStart: "auto",
    marginInlineEnd: `calc((${control.heightSm} - ${glyph.sm}) / 2 - ${button.paddingInlineSm})`,
  },
  swap: { display: "inline-block", whiteSpace: "nowrap" },
  slot: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    width: glyph.md,
    height: glyph.md,
  },
  quiet: { color: role.contentTertiary },
});

export function useStopTasks<Id extends string, Outcome>(stopOne: (id: Id) => Promise<Outcome>) {
  const [stopping, setStopping] = useState<ReadonlySet<string>>(new Set());

  const mutation = useMutation({
    mutationFn: (ids: readonly Id[]) => Promise.all(ids.map(stopOne)),
    onMutate: (ids) => setStopping((current) => new Set([...current, ...ids])),
    onSettled: (_outcomes, _error, ids) =>
      setStopping(
        (current) => new Set([...current].filter((id) => !ids.some((one) => one === id))),
      ),
  });

  return {
    stopping,
    run: (ids: readonly Id[]) => mutation.mutate(ids),
    failed: mutation.isError,
    outcomes: mutation.data,
    reset: mutation.reset,
  };
}

export function TaskGlyph({
  state,
  unread = false,
  job = false,
  stopped = false,
}: {
  readonly state: TaskState;
  readonly unread?: boolean;
  readonly job?: boolean;
  readonly stopped?: boolean;
}): ReactElement | null {
  if (!taskEnded(state) || (state === "done" && unread))
    return <TaskMark state={state} unread={unread} job={job} />;

  const failed = state === "failed" && !stopped;

  const ending: { readonly icon: IconName; readonly label: string } = stopped
    ? { icon: "circle-ban", label: "Stopped" }
    : failed
      ? { icon: "circle-x", label: "Failed" }
      : { icon: "circle-check", label: "Done" };

  return (
    <span
      {...props(failed && intent.danger, styles.slot, failed ? styles.secondary : styles.quiet)}
    >
      <Icon name={ending.icon} size="sm" label={ending.label} />
    </span>
  );
}

export function TaskList<T extends Task>({
  parent,
  tasks,
  noun,
  label,
  maxHeight,
  stopping,
  onStop,
  onOpen,
}: {
  readonly parent: SessionId;
  readonly tasks: readonly T[];
  readonly noun: string;
  readonly label: (task: T) => string;
  readonly maxHeight: number;
  readonly stopping: ReadonlySet<string>;
  readonly onStop: (ids: readonly T["id"][]) => void;
  readonly onOpen: (task: T) => void;
}): ReactElement {
  const reduced = useReducedMotion() === true;
  const unread = useChatWindow((snapshot) => snapshot.unread);
  const [armed, setArmed] = useState(false);
  const [height, setHeight] = useState<number | null>(null);
  const running = tasks.filter((task) => !taskEnded(task.state));
  const finished = tasks.filter((task) => taskEnded(task.state));
  const stoppable = running.filter((task) => task.live && !stopping.has(task.id));
  const grouped = running.length >= BULK_MIN || finished.length >= BULK_MIN;
  const move = reduced ? { duration: 0 } : SETTLE;

  const clear = (ids: readonly T["id"][]): void =>
    chatWindow.act({ kind: "clear", parent, tasks: ids });

  const measure = (node: HTMLDivElement | null): (() => void) | undefined => {
    if (node === null) return undefined;

    const observer = new ResizeObserver((entries) => {
      const size = entries[0]?.borderBoxSize[0];

      if (size !== undefined) setHeight(size.blockSize);
    });

    observer.observe(node);

    return () => observer.disconnect();
  };

  const placed = (key: string, child: ReactNode): ReactElement => (
    <motion.div
      key={key}
      layout={reduced ? false : "position"}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ layout: move, opacity: FADE }}
    >
      {child}
    </motion.div>
  );

  const row = (task: T): ReactElement =>
    placed(
      task.id,
      <Row xstyle={styles.row} interactive>
        <Row.Primary
          aria-label={`Open ${label(task)}`}
          title={label(task)}
          onClick={() => onOpen(task)}
        >
          <Row.Leading>
            <TaskGlyph
              state={task.state}
              unread={task.kind === "child" && unread.has(task.id)}
              job={task.kind === "job"}
              stopped={
                task.kind === "job" &&
                task.job?.state.kind === "exited" &&
                task.job.state.reason === "terminated"
              }
            />
          </Row.Leading>
          <Row.Label xstyle={taskEnded(task.state) && styles.secondary}>{label(task)}</Row.Label>
        </Row.Primary>
        {(task.live || taskEnded(task.state)) && (
          <Row.Actions xstyle={styles.rowActions}>
            {task.live ? (
              <Button
                size="sm"
                variant="plain"
                iconOnly
                icon="square"
                aria-label={`Stop ${label(task)}`}
                tone={armed && !stopping.has(task.id) ? "danger" : undefined}
                loading={stopping.has(task.id)}
                onClick={() => onStop([task.id])}
              />
            ) : (
              <Button
                size="sm"
                variant="plain"
                iconOnly
                icon="eraser"
                aria-label={`Clear ${label(task)}`}
                onClick={() => clear([task.id])}
              />
            )}
          </Row.Actions>
        )}
      </Row>,
    );

  const heading = (key: string, name: string, count: number, later: boolean, action: ReactNode) =>
    placed(
      key,
      <div {...props(text.sm, styles.section, later && styles.later)}>
        <span>{name}</span>
        <span {...props(styles.count)}>{String(count)}</span>
        <span {...props(styles.sectionAction)}>{action}</span>
      </div>,
    );

  const items = [
    ...(grouped && running.length > 0
      ? [
          heading(
            "running",
            "Running",
            running.length,
            false,
            running.filter((task) => task.live).length >= BULK_MIN && (
              <Button
                size="sm"
                variant={armed ? "solid" : "ghost"}
                tone="danger"
                loading={stoppable.length === 0}
                title={
                  armed
                    ? `Press again to stop ${String(stoppable.length)} ${noun}`
                    : `Stop all ${String(stoppable.length)} running ${noun}`
                }
                onClick={() => {
                  setArmed(!armed);

                  if (armed) onStop(stoppable.map((task) => task.id));
                }}
                onBlur={() => setArmed(false)}
                onKeyDown={(event) => {
                  if (event.key !== "Escape" || !armed) return;
                  event.preventDefault();
                  event.stopPropagation();
                  setArmed(false);
                }}
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={armed ? "armed" : "idle"}
                    initial={{
                      opacity: 0,
                      y: reduced ? 0 : 4,
                      filter: reduced ? "blur(0px)" : "blur(2px)",
                    }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    exit={{
                      opacity: 0,
                      y: reduced ? 0 : -4,
                      filter: reduced ? "blur(0px)" : "blur(2px)",
                    }}
                    transition={SWAP}
                    {...props(styles.swap, styles.count)}
                  >
                    {armed ? `Stop ${String(stoppable.length)}?` : "Stop All"}
                  </motion.span>
                </AnimatePresence>
                <Icon name="square" size="sm" />
              </Button>
            ),
          ),
        ]
      : []),
    ...running.map(row),
    ...(grouped && finished.length > 0
      ? [
          heading(
            "finished",
            "Finished",
            finished.length,
            running.length > 0,
            finished.length >= BULK_MIN && (
              <Button size="sm" onClick={() => clear(finished.map((task) => task.id))}>
                Clear All
                <Icon name="eraser" size="sm" />
              </Button>
            ),
          ),
        ]
      : []),
    ...finished.map(row),
  ];

  return (
    <motion.div
      data-nyte-scrollport
      layoutScroll
      initial={false}
      animate={{ height: height ?? "auto" }}
      transition={move}
      {...props(styles.scroll(maxHeight))}
    >
      <div role="status" {...props(srOnly)}>
        {stopping.size > 0 && `Stopping ${String(stopping.size)} ${noun}…`}
      </div>
      <div ref={measure} {...props(styles.list)}>
        <AnimatePresence initial={false} mode="popLayout">
          {items}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
