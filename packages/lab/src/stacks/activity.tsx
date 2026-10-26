import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { Avatar, AvatarFallback } from "@nyte-ai/ui/avatar";
import { Icon } from "@nyte-ai/ui/icon";
import { avatar, button, radius, row, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { YOU } from "./model.ts";
import type { Attachment, Check, DiffLine, Event } from "./model.ts";
import { ago } from "./parts.tsx";
import { Shot } from "./shots.tsx";

const styles = create({
  list: { display: "flex", flexDirection: "column", margin: 0, padding: 0, listStyle: "none" },
  event: {
    position: "relative",
    display: "grid",
    gridTemplateColumns: "20px minmax(0, 1fr)",
    columnGap: space.s3,
    paddingBlockEnd: space.s5,
  },
  rail: {
    position: "absolute",
    insetBlock: "22px 2px",
    insetInlineStart: 9.5,
    width: 1,
    backgroundColor: role.borderSecondaryTranslucent,
  },
  railLast: { display: "none" },
  marker: { display: "grid", placeItems: "center", height: avatar.xs },
  dot: { width: 5, height: 5, borderRadius: radius.pill, backgroundColor: role.contentDisabled },
  body: { display: "flex", flexDirection: "column", gap: space.s1_5, minWidth: 0 },
  head: {
    display: "flex",
    alignItems: "center",
    gap: space.s1_5,
    minHeight: avatar.xs,
    color: role.contentTertiary,
  },
  who: { color: role.contentSecondary, fontWeight: type.weightMedium },
  separator: { color: role.contentDisabled },
  said: { margin: 0, color: role.contentPrimary, textWrap: "pretty" },
  quote: {
    margin: 0,
    paddingBlock: space.s2,
    paddingInline: space.s3,
    borderRadius: radius.card,
    backgroundColor: role.bgBase,
    boxShadow: `0 0 0 1px ${role.borderSecondaryTranslucent}`,
    color: role.contentPrimary,
    textWrap: "pretty",
  },
  checks: {
    display: "flex",
    flexWrap: "wrap",
    gap: space.s1_5,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  check: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s1_5,
    height: button.heightSm,
    paddingInline: space.s2,
    borderRadius: radius.control,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
    color: role.contentSecondary,
  },
  checkGlyph: { display: "inline-flex", color: role.contentInteractivePrimary },
  checkPending: { color: role.contentTertiary },
  images: { display: "flex", flexWrap: "wrap", gap: space.s2 },
  image: {
    display: "block",
    maxWidth: 240,
    maxHeight: 160,
    borderRadius: radius.control,
    boxShadow: `0 0 0 1px ${role.borderSecondaryTranslucent}`,
    objectFit: "cover",
  },
  diff: {
    borderRadius: radius.card,
    boxShadow: `0 0 0 1px ${role.borderSecondaryTranslucent}`,
    overflow: "hidden",
  },
  diffHead: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    height: row.heightLg,
    paddingInline: space.s3,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: role.borderSecondaryTranslucent,
    color: role.contentSecondary,
  },
  diffBody: { margin: 0, paddingBlock: space.s1_5 },
  diffLine: {
    display: "grid",
    gridTemplateColumns: "20px minmax(0, 1fr)",
    paddingInlineEnd: space.s3,
    whiteSpace: "pre",
  },
  diffSign: { textAlign: "center", color: role.contentTertiary },
  diffChanged: {
    backgroundColor: `color-mix(in oklab, ${role.contentInteractivePrimary} 10%, transparent)`,
  },
  diffChangedSign: { color: role.contentInteractivePrimary },
});

export function Activity({
  events,
  clock,
}: {
  readonly events: readonly Event[];
  readonly clock: number;
}): ReactElement {
  return (
    <ol aria-label="Activity" {...props(styles.list)}>
      {events.map((event, index) => (
        <li key={event.id} {...props(styles.event)}>
          <span
            aria-hidden="true"
            {...props(styles.rail, index === events.length - 1 && styles.railLast)}
          />
          <span {...props(styles.marker)}>
            {event.mine === true ? (
              <Avatar size="xs" tone={YOU.tone}>
                <AvatarFallback>{YOU.initials}</AvatarFallback>
              </Avatar>
            ) : (
              <span {...props(styles.dot)} />
            )}
          </span>
          <div {...props(styles.body)}>
            <span {...props(text.sm, styles.head)}>
              <span {...props(styles.who)}>{event.who}</span>
              {event.what}
              <span aria-hidden="true" {...props(styles.separator)}>
                ·
              </span>
              {ago(event.at, clock)}
            </span>
            <p
              {...props(
                text.base,
                event.mine === true && event.what === "asked" ? styles.quote : styles.said,
              )}
            >
              {event.text}
            </p>
            {event.attachment !== undefined && <Evidence attachment={event.attachment} />}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Evidence({ attachment }: { readonly attachment: Attachment }): ReactElement {
  return (
    <>
      {attachment.checks !== undefined && <Checks checks={attachment.checks} />}
      {attachment.diff !== undefined && (
        <Diff file={attachment.diff.file} lines={attachment.diff.lines} />
      )}
      {attachment.shot !== undefined && <Shot id={attachment.shot} />}
      {attachment.images !== undefined && <Images images={attachment.images} />}
    </>
  );
}

export function Images({ images }: { readonly images: readonly string[] }): ReactElement {
  return (
    <span {...props(styles.images)}>
      {images.map((image, index) => (
        <img
          key={image}
          src={image}
          alt={`Attachment ${String(index + 1)}`}
          {...props(styles.image)}
        />
      ))}
    </span>
  );
}

export function Checks({ checks }: { readonly checks: readonly Check[] }): ReactElement {
  return (
    <ul aria-label="Checks" {...props(styles.checks)}>
      {checks.map((check) => (
        <li
          key={check.name}
          {...props(
            text.sm,
            check.outcome === "failed" ? intent.danger : intent.success,
            styles.check,
          )}
        >
          <span {...props(styles.checkGlyph, check.outcome === "pending" && styles.checkPending)}>
            <Icon
              name={
                check.outcome === "failed"
                  ? "circle-x"
                  : check.outcome === "passed"
                    ? "checkmark"
                    : "clock"
              }
              size={12}
            />
          </span>
          {check.name}
        </li>
      ))}
    </ul>
  );
}

function Diff({
  file,
  lines,
}: {
  readonly file: string;
  readonly lines: readonly DiffLine[];
}): ReactElement {
  return (
    <div {...props(styles.diff)}>
      <div {...props(text.sm, styles.diffHead)}>
        <Icon name="file" size={12} />
        {file}
      </div>
      <pre {...props(text.code, styles.diffBody)}>
        {lines.map((line, index) => (
          <span
            // oxlint-disable-next-line react/no-array-index-key -- diff lines repeat and have no identity
            key={index}
            {...props(
              line.sign === "+" ? intent.success : line.sign === "-" && intent.danger,
              styles.diffLine,
              line.sign !== " " && styles.diffChanged,
            )}
          >
            <span {...props(styles.diffSign, line.sign !== " " && styles.diffChangedSign)}>
              {line.sign}
            </span>
            {line.text}
          </span>
        ))}
      </pre>
    </div>
  );
}
