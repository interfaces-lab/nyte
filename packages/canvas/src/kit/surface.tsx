import { create, props } from "@stylexjs/stylex";
import { createContext } from "react";
import type { ReactElement, ReactNode } from "react";
import { Icon } from "@nyte-ai/ui/icon";
import type { IconName } from "@nyte-ai/ui/icon";
import { hairline } from "@nyte-ai/ui/styles/hairline.stylex";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { intent, surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, shadow, type } from "@nyte-ai/ui/styles/vars.stylex";

export const FlushCardContext = createContext(false);

const card = create({
  root: {
    "--nyte-hairline-elevation": shadow.shadowSm,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    borderRadius: radius.card,
    backgroundColor: role.bgElevated,
    color: role.contentPrimary,
  },
  head: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: space.s3,
    minWidth: 0,
    paddingTop: space.s3,
    paddingInline: space.s4,
  },
  divided: { paddingBottom: space.s3 },
  titles: { display: "flex", flexDirection: "column", gap: space.s0_5, minWidth: 0 },
  title: {
    margin: 0,
    color: role.contentPrimary,
    fontWeight: type.weightSemibold,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  description: { margin: 0, color: role.contentSecondary, textWrap: "pretty" },
  actions: { display: "flex", alignItems: "center", gap: space.s1, flexShrink: 0 },
  body: { minWidth: 0 },
  titled: { paddingTop: space.s3 },
  0: { padding: 0 },
  2: { padding: space.s2 },
  3: { padding: space.s3 },
  4: { padding: space.s4 },
});

export function Card({
  title,
  description,
  actions,
  padding = 4,
  children,
}: {
  readonly title?: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly padding?: 0 | 2 | 3 | 4;
  readonly children?: ReactNode;
}): ReactElement {
  const titled = title !== undefined || actions !== undefined;

  return (
    <section {...props(hairline.ring, card.root)}>
      {titled ? (
        <header {...props(card.head, padding === 0 && [card.divided, hairline.blockEnd])}>
          <div {...props(card.titles)}>
            <h3 {...props(text.base, card.title)}>{title}</h3>
            {description === undefined ? null : (
              <p {...props(text.sm, card.description)}>{description}</p>
            )}
          </div>
          {actions === undefined ? null : <div {...props(card.actions)}>{actions}</div>}
        </header>
      ) : null}
      <div {...props(card.body, card[padding], titled && padding !== 0 && card.titled)}>
        <FlushCardContext value={padding === 0}>{children}</FlushCardContext>
      </div>
    </section>
  );
}

const section = create({
  root: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0 },
  head: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: space.s3,
    minWidth: 0,
  },
  titles: { display: "flex", flexDirection: "column", gap: space.s0_5, minWidth: 0 },
  title: {
    margin: 0,
    color: role.contentPrimary,
    fontWeight: type.weightSemibold,
    textWrap: "balance",
  },
  description: { margin: 0, color: role.contentSecondary, textWrap: "pretty" },
  actions: { display: "flex", alignItems: "center", gap: space.s1, flexShrink: 0 },
});

export function Section({
  title,
  description,
  actions,
  children,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <section {...props(section.root)}>
      <header {...props(section.head)}>
        <div {...props(section.titles)}>
          <h2 {...props(text.lg, section.title)}>{title}</h2>
          {description === undefined ? null : (
            <p {...props(text.sm, section.description)}>{description}</p>
          )}
        </div>
        {actions === undefined ? null : <div {...props(section.actions)}>{actions}</div>}
      </header>
      {children}
    </section>
  );
}

const CALLOUT_ICONS = {
  info: "circle-info",
  success: "checkmark",
  warning: "warning",
  danger: "circle-x",
} as const satisfies Record<string, IconName>;

const CALLOUT_TONES = {
  info: surfaceTheme.blue,
  success: intent.success,
  warning: intent.warning,
  danger: intent.danger,
} as const;

const callout = create({
  root: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    columnGap: space.s2_5,
    rowGap: space.s0_5,
    paddingBlock: space.s3,
    paddingInline: space.s3,
    borderRadius: radius.card,
    backgroundColor: role.bgMutedTranslucent,
    color: role.contentPrimary,
  },
  glyph: {
    display: "flex",
    alignItems: "center",
    height: type.leadingBase,
    color: role.contentAccent,
  },
  title: { gridColumn: 2, color: role.contentPrimary, fontWeight: type.weightSemibold },
  body: { gridColumn: 2, minWidth: 0, color: role.contentSecondary },
});

export function Callout({
  tone = "info",
  title,
  children,
}: {
  readonly tone?: "info" | "success" | "warning" | "danger";
  readonly title?: string;
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <div
      role={tone === "danger" || tone === "warning" ? "alert" : "note"}
      {...props(CALLOUT_TONES[tone], text.base, callout.root)}
    >
      <span {...props(callout.glyph)}>
        <Icon name={CALLOUT_ICONS[tone]} size="sm" />
      </span>
      {title === undefined ? null : <span {...props(callout.title)}>{title}</span>}
      <div {...props(callout.body)}>{children}</div>
    </div>
  );
}

const code = create({
  inline: {
    paddingBlock: space.px,
    paddingInline: space.s1,
    borderRadius: radius.indicator,
    backgroundColor: role.fillTertiary,
    color: role.contentPrimary,
    fontVariantLigatures: "none",
  },
  frame: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    borderRadius: radius.card,
    backgroundColor: role.bgMuted,
  },
  head: {
    minWidth: 0,
    paddingBlock: space.s1_5,
    paddingInline: space.s3,
    color: role.contentSecondary,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  pre: {
    margin: 0,
    paddingBlock: space.s2_5,
    paddingInline: space.s3,
    color: role.contentPrimary,
    fontVariantLigatures: "none",
    overflowX: "auto",
    whiteSpace: "pre",
  },
});

export function Code({
  block = false,
  title,
  children,
}: {
  readonly block?: boolean;
  readonly title?: string;
  readonly children: string;
}): ReactElement {
  if (!block) return <code {...props(text.code, code.inline)}>{children}</code>;

  return (
    <figure {...props(hairline.ring, code.frame)}>
      {title === undefined ? null : (
        <figcaption {...props(text.code, code.head, hairline.blockEnd)}>{title}</figcaption>
      )}
      <pre {...props(text.code, code.pre)}>
        <code>{children}</code>
      </pre>
    </figure>
  );
}
