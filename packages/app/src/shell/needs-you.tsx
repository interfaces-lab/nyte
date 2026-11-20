import { props } from "@stylexjs/stylex";
import { useRef, useState } from "react";
import type { ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Popover } from "@nyte-ai/ui/popover";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { ToastStack, toast, toastHolds, useHeldToasts, useToasts } from "@nyte-ai/ui/toast";
import { Deferred, loadDeferred } from "../lib/deferred.tsx";
import type { Visits } from "./needs-you-list.deferred.tsx";
import { NEEDS_YOU_ANCHOR, needsYouStyles as styles } from "./needs-you.stylex.ts";

const BADGE_CAP = 9;

/**
 * Base UI traps focus in a popover only when it holds a close part, so the list renders a hidden one.
 *
 * The title bar clips the bell when the workbench leaves the chat side no room, and Chromium hides a box
 * anchored to a clipped anchor, so the stack lets go of the bell until it shows again. A bell
 * clipped flush to the edge still counts as intersecting, so only a visible area counts as shown.
 */
export function NeedsYou(): ReactElement {
  const toasts = useToasts();
  const held = useHeldToasts();
  const [open, setOpen] = useState(false);
  const [bellShown, setBellShown] = useState(true);
  const [visits, setVisits] = useState<Visits>({ opened: 0, closed: 0 });
  const bell = useRef<HTMLButtonElement>(null);
  const live = toasts.filter((item) => item.transitionStatus !== "ending");
  const waiting = [...live.filter(toastHolds), ...held];
  const urgent = waiting.some((item) => item.type === "error");

  const close = (event: Event): void => {
    setOpen(false);
    setVisits({ ...visits, closed: eventTime(event) });

    for (const item of live) {
      if (item.type === "loading" || item.timeout === 0) continue;

      if (toastHolds(item)) toast.hold(item.id);
      else toast.close(item.id);
    }
  };

  return (
    <Popover.Root
      open={open}
      modal="trap-focus"
      onOpenChange={(next, details) => {
        if (!next) {
          close(details.event);

          return;
        }

        setOpen(true);
        setVisits({ ...visits, opened: eventTime(details.event) });
      }}
    >
      <span ref={observeBell(setBellShown)} {...props(styles.anchor)}>
        <Popover.Trigger
          ref={bell}
          onPointerEnter={() => void loadDeferred("needsYou")}
          onFocus={() => void loadDeferred("needsYou")}
          render={<Button iconOnly icon="bell" aria-label={label(waiting.length)} />}
        />
        {waiting.length > 0 && (
          <span
            aria-hidden
            {...props(urgent && intent.danger, text.xs, styles.badge, urgent && styles.urgent)}
          >
            {waiting.length > BADGE_CAP ? `${BADGE_CAP}+` : waiting.length}
          </span>
        )}
      </span>
      <ToastStack anchor={bellShown ? NEEDS_YOU_ANCHOR : undefined} hidden={open} />
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={4}>
          <Deferred entry="needsYou">
            {(runtime) => (
              <runtime.NeedsYouList
                live={live}
                held={held}
                visits={visits}
                onAct={(item, event) => {
                  close(event.nativeEvent);
                  bell.current?.focus();
                  toast.close(item.id);
                  item.actionProps?.onClick?.(event);
                }}
              />
            )}
          </Deferred>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function observeBell(
  onChange: (shown: boolean) => void,
): (bell: HTMLElement | null) => (() => void) | undefined {
  return (bell) => {
    if (bell === null) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1);

        if (entry !== undefined) onChange(entry.intersectionRatio > 0);
      },
      { threshold: 0.01 },
    );

    observer.observe(bell);

    return () => observer.disconnect();
  };
}

function eventTime(event: Event): number {
  return performance.timeOrigin + event.timeStamp;
}

function label(count: number): string {
  if (count === 0) return "Needs You";

  return `Needs You, ${count} item${count === 1 ? "" : "s"}`;
}
