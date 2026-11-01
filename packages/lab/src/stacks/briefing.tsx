import { create, props } from "@stylexjs/stylex";
import { Fragment } from "react";
import type { ReactElement, ReactNode } from "react";
import { Icon } from "@nyte-ai/ui/icon";
import type { IconName } from "@nyte-ai/ui/icon";
import { focus } from "@nyte-ai/ui/styles/a11y.stylex";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import type { Item } from "./model.ts";
import { StepTile } from "./parts.tsx";
import { arrange, lane, progress } from "./progress.ts";
import { WATCHER } from "./staffing.ts";

const styles = create({
  briefing: { display: "flex", flexDirection: "column", gap: space.s3 },
  lead: { margin: 0, color: role.contentPrimary, textWrap: "pretty" },
  rest: { margin: 0, color: role.contentSecondary, textWrap: "pretty" },
  link: {
    color: role.contentPrimary,
    fontWeight: type.weightMedium,
    textDecorationLine: { default: "none", ":hover": "underline" },
    textDecorationColor: role.borderStrong,
    textUnderlineOffset: "3px",
    borderRadius: radius.indicator,
  },
  linkTile: { marginInlineEnd: space.s1 },
  more: {
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: "inherit",
    font: "inherit",
    textDecorationLine: "underline",
    textDecorationStyle: "dotted",
    textDecorationColor: role.contentTertiary,
    textUnderlineOffset: "4px",
    cursor: "pointer",
    borderRadius: radius.indicator,
  },
  notes: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
    margin: 0,
    padding: 0,
    listStyle: "none",
    color: role.contentTertiary,
  },
  note: { display: "flex", alignItems: "center", gap: space.s2 },
  noteGlyph: { display: "inline-flex", flexShrink: 0 },
  action: {
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: role.contentSecondary,
    font: "inherit",
    textDecorationLine: { default: "none", ":hover": "underline" },
    cursor: "pointer",
    borderRadius: radius.indicator,
  },
});

/**
 * The page in a few sentences: the one thing to do first, what the agents are on, then anything
 * held up. Every title is a link, and hovering one lights its row below.
 */
export function Briefing({
  items,
  changed,
  onOpen,
  onLink,
  onSeen,
}: {
  readonly items: readonly Item[];
  readonly changed: number;
  readonly onOpen: (item: string) => void;
  readonly onLink: (item: string | null) => void;
  readonly onSeen: () => void;
}): ReactElement {
  const ordered = arrange(items);
  const yours = ordered.filter((item) => lane(item) === "you");
  const running = ordered.filter((item) => lane(item) === "progress");
  const watched = ordered.filter((item) => lane(item) === "watching");
  const queued = ordered.filter((item) => lane(item) === "next");
  const first = yours[0];

  const link = (item: Item): ReactElement => (
    <a
      key={item.id}
      href={`#${item.id}`}
      onClick={(event) => {
        event.preventDefault();
        onLink(null);
        onOpen(item.id);
      }}
      onMouseEnter={() => onLink(item.id)}
      onMouseLeave={() => onLink(null)}
      onFocus={() => onLink(item.id)}
      onBlur={() => onLink(null)}
      {...props(styles.link, focus.ring)}
    >
      <span {...props(styles.linkTile)}>
        <StepTile progress={progress(item)} size="xs" />
      </span>
      {item.title}
    </a>
  );

  const more = (count: number, id: string): ReactElement => (
    <button
      type="button"
      onClick={() => document.getElementById(`lane-${id}`)?.scrollIntoView({ behavior: "smooth" })}
      {...props(styles.more, focus.ring)}
    >
      {count} more
    </button>
  );

  if (items.length === 0)
    return (
      <p {...props(text.lg, styles.rest)}>Nothing in flight. Write what you want done below.</p>
    );

  return (
    <div {...props(styles.briefing)}>
      <p {...props(text.lg, styles.lead)}>
        {first === undefined ? (
          "Nothing needs you."
        ) : (
          <>
            Start with {link(first)}: {reason(first)}
            {yours.length > 1 && (
              <span {...props(styles.rest)}>
                {" "}
                Then{" "}
                {yours.length === 2
                  ? "one more needs"
                  : `${String(yours.length - 1)} more need`}{" "}
                you.
              </span>
            )}
          </>
        )}
      </p>
      {(running.length > 0 || watched.length > 0) && (
        <p {...props(text.lg, styles.rest)}>
          {running.length > 0 && (
            <>
              Agents are{" "}
              {listed(
                running.slice(0, 2).map((item) => (
                  <Fragment key={item.id}>
                    {progress(item).doing} {link(item)}
                  </Fragment>
                )),
                running.length > 2 ? more(running.length - 2, "progress") : null,
              )}
              .{" "}
            </>
          )}
          {watched.length > 0 && (
            <>
              {WATCHER} is watching{" "}
              {listed(
                watched.slice(0, 2).map(link),
                watched.length > 2 ? more(watched.length - 2, "watching") : null,
              )}{" "}
              with no model running.
            </>
          )}
        </p>
      )}
      {(queued.length > 0 || changed > 0) && (
        <ul {...props(text.sm, styles.notes)}>
          {queued.length > 0 && (
            <Note icon="clock">
              {queued.length === 1
                ? "1 task waits for another to finish first."
                : `${String(queued.length)} tasks wait for another to finish first.`}{" "}
              <button
                type="button"
                onClick={() =>
                  document.getElementById("lane-next")?.scrollIntoView({ behavior: "smooth" })
                }
                {...props(styles.action, focus.ring)}
              >
                Show
              </button>
            </Note>
          )}
          {changed > 0 && (
            <Note icon="status">
              {changed === 1 ? "1 changed" : `${String(changed)} changed`} since you looked.{" "}
              <button type="button" onClick={onSeen} {...props(styles.action, focus.ring)}>
                Mark Seen
              </button>
            </Note>
          )}
        </ul>
      )}
    </div>
  );
}

function Note({
  icon,
  children,
}: {
  readonly icon: IconName;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <li {...props(styles.note)}>
      <span {...props(styles.noteGlyph)}>
        <Icon name={icon} size="xs" />
      </span>
      <span>{children}</span>
    </li>
  );
}

/** Why it's first, as the end of "Start with X: …". */
function reason(item: Item): string {
  if (item.now === "Ready to merge") return "it's green and ready to merge.";
  const said = item.now.charAt(0).toLowerCase() + item.now.slice(1);

  return /[.?!]$/.test(said) ? said : `${said}.`;
}

/** "a", "a and b", "a, b and 3 more". */
function listed(parts: readonly ReactNode[], tail: ReactNode): ReactNode {
  const all = tail === null ? parts : [...parts, tail];

  return all.map((part, index) => (
    <Fragment key={index}>
      {index === 0 ? "" : index === all.length - 1 ? " and " : ", "}
      {part}
    </Fragment>
  ));
}
