import { props } from "@stylexjs/stylex";
import { useId, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Kbd } from "@nyte-ai/ui/kbd";
import { Popover } from "@nyte-ai/ui/popover";
import { Row } from "@nyte-ai/ui/row";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import {
  ToastGlyph,
  ToastStack,
  toast,
  toastHolds,
  useHeldToasts,
  useToasts,
} from "@nyte-ai/ui/toast";
import type { HeldToast, ToastItem } from "@nyte-ai/ui/toast";
import { formatTimeAgo } from "../lib/format.ts";
import { useNowMinute } from "../lib/use-now-minute.ts";
import { NEEDS_YOU_ANCHOR, needsYouStyles as styles } from "./needs-you.stylex.ts";

const BADGE_CAP = 9;

interface Visits {
  readonly opened: number;
  readonly closed: number;
}

// Base UI traps focus in a popover only when it holds a close part, so the list renders a hidden one.
export function NeedsYou(): ReactElement {
  const toasts = useToasts();
  const held = useHeldToasts();
  const [open, setOpen] = useState(false);
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
      <span {...props(styles.anchor)}>
        <Popover.Trigger
          ref={bell}
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
      <ToastStack anchor={NEEDS_YOU_ANCHOR} hidden={open} />
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={4}>
          <NeedsYouList
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
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function NeedsYouList({
  live,
  held,
  visits,
  onAct,
}: {
  readonly live: readonly ToastItem[];
  readonly held: readonly HeldToast[];
  readonly visits: Visits;
  readonly onAct: (item: HeldToast, event: MouseEvent<HTMLButtonElement>) => void;
}): ReactElement {
  const now = useNowMinute();
  const popup = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string>();
  const rows = [...live, ...held].toSorted((a, b) => (b.data?.at ?? 0) - (a.data?.at ?? 0));
  const active = rows.find((item) => item.id === activeId) ?? rows[0];

  return (
    <Popover.Popup
      ref={popup}
      aria-label="Needs You"
      initialFocus={() =>
        popup.current?.querySelector<HTMLElement>("[data-entry-id][tabindex='0']") ?? true
      }
    >
      <div
        onKeyDown={(event) => moveInList(event, () => popup.current?.focus())}
        {...props(styles.panel)}
      >
        <Popover.Close tabIndex={-1} {...props(srOnly)}>
          Close Needs You
        </Popover.Close>
        <div {...props(styles.head)}>
          <h2 {...props(text.base, styles.heading)}>Needs You</h2>
          {rows.length > 0 && (
            <Button
              size="xs"
              variant="text"
              tone="neutral"
              onClick={() => {
                for (const item of rows) toast.close(item.id);
              }}
            >
              Dismiss All
            </Button>
          )}
        </div>
        {rows.length === 0 ? (
          <div {...props(styles.empty)}>
            <Icon name="inbox-checked" size="lg" />
            <p {...props(text.sm, styles.emptyText)}>Nothing needs you</p>
          </div>
        ) : (
          <div role="list" {...props(styles.list)}>
            {rows.map((item) => (
              <NeedsYouEntry
                key={item.id}
                item={item}
                active={item === active}
                fresh={(item.data?.at ?? 0) > visits.closed && toastHolds(item)}
                arriving={(item.data?.at ?? 0) > visits.opened}
                age={formatTimeAgo(item.data?.at ?? now, now)}
                onFocus={() => setActiveId(item.id)}
                onAct={(event) => onAct(item, event)}
              />
            ))}
          </div>
        )}
        {rows.length > 0 && (
          <div {...props(text.xs, styles.foot)}>
            <span {...props(styles.hint)}>
              <Kbd keys={["↑", "↓"]} />
              Move
            </span>
            {active?.actionProps !== undefined && (
              <span {...props(styles.hint)}>
                <Kbd keys={["↵"]} />
                {active.actionProps.children}
              </span>
            )}
            <span {...props(styles.hint)}>
              <Kbd keys={["⌫"]} />
              Dismiss
            </span>
          </div>
        )}
      </div>
    </Popover.Popup>
  );
}

function NeedsYouEntry({
  item,
  active,
  fresh,
  arriving,
  age,
  onFocus,
  onAct,
}: {
  readonly item: HeldToast;
  readonly active: boolean;
  readonly fresh: boolean;
  readonly arriving: boolean;
  readonly age: string;
  readonly onFocus: () => void;
  readonly onAct: (event: MouseEvent<HTMLButtonElement>) => void;
}): ReactElement {
  const action = item.actionProps;
  const titleId = useId();
  const actionId = useId();
  const describedBy = useId();
  const count = item.data?.count ?? 1;

  return (
    <Row
      variant="bare"
      role="listitem"
      onFocus={onFocus}
      xstyle={[text.sm, styles.entry, arriving && styles.arriving]}
    >
      <Row.Primary
        data-entry-id={item.id}
        tabIndex={active ? 0 : -1}
        aria-labelledby={action === undefined ? titleId : `${titleId} ${actionId}`}
        aria-describedby={item.description === undefined ? undefined : describedBy}
        render={action === undefined ? <div role="group" /> : undefined}
        onClick={action === undefined ? undefined : onAct}
        xstyle={[styles.target, action === undefined && styles.inert]}
      />
      <ToastGlyph type={item.type} />
      <span id={titleId} {...props(text.base, styles.title, fresh && styles.unreadTitle)}>
        {item.title}
      </span>
      <span aria-hidden {...props(text.xs, styles.trail)}>
        {count > 1 && <span>×{count}</span>}
        {age}
        {fresh && <span {...props(intent.primary, styles.dot)} />}
      </span>
      <span {...props(styles.dismiss)}>
        <Button
          size="sm"
          iconOnly
          icon="close"
          tabIndex={-1}
          aria-label="Dismiss"
          onClick={() => toast.close(item.id)}
        />
      </span>
      {item.description !== undefined && (
        <p id={describedBy} {...props(text.sm, styles.description)}>
          {item.description}
        </p>
      )}
      {action !== undefined && (
        <span id={actionId} {...props(intent.primary, text.sm, styles.action)}>
          {action.children}
        </span>
      )}
    </Row>
  );
}

function moveInList(event: KeyboardEvent<HTMLDivElement>, focusPopup: () => void): void {
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  const target = event.target instanceof Node ? event.target : null;
  const rows = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-entry-id]")];
  const at = rows.findIndex((row) => row.parentElement?.contains(target) ?? false);

  const move = (index: number): void => {
    event.preventDefault();
    rows[Math.min(Math.max(index, 0), rows.length - 1)]?.focus();
  };

  if (at === -1) {
    if (event.key === "ArrowDown") move(rows.findIndex((row) => row.tabIndex === 0));

    return;
  }

  switch (event.key) {
    case "ArrowDown":
      move(at + 1);

      return;
    case "ArrowUp":
      move(at - 1);

      return;
    case "Home":
      move(0);

      return;
    case "End":
      move(rows.length - 1);

      return;
    case "Backspace":
    case "Delete": {
      const id = rows[at]?.dataset.entryId;

      if (id === undefined) return;
      event.preventDefault();
      const neighbour = rows[at + 1] ?? rows[at - 1];

      toast.close(id);

      if (neighbour === undefined) focusPopup();
      else neighbour.focus();

      return;
    }

    default:
  }
}

function eventTime(event: Event): number {
  return performance.timeOrigin + event.timeStamp;
}

function label(count: number): string {
  if (count === 0) return "Needs You";

  return `Needs You, ${count} item${count === 1 ? "" : "s"}`;
}
