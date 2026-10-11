import { create, props } from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";
import { radius } from "@nyte-ai/ui/schema.stylex";
import { role, type } from "@nyte-ai/ui/vars.stylex";

const heading = create({
  base: { margin: 0, color: role.contentPrimary, fontWeight: 600, textWrap: "balance" },
  1: { fontSize: type.font2xl, lineHeight: type.leadingLg, letterSpacing: type.letterLg },
  2: { fontSize: type.fontLg, lineHeight: type.leadingLg, letterSpacing: type.letterLg },
  3: { fontSize: type.fontBase, lineHeight: type.leadingBase, letterSpacing: type.letterBase },
});

export function Heading({
  level = 2,
  children,
}: {
  readonly level?: 1 | 2 | 3;
  readonly children?: ReactNode;
}): ReactElement {
  const styled = props(heading.base, heading[level]);

  if (level === 1) return <h1 {...styled}>{children}</h1>;

  if (level === 3) return <h3 {...styled}>{children}</h3>;

  return <h2 {...styled}>{children}</h2>;
}

const text = create({
  base: {
    margin: 0,
    minWidth: 0,
    color: role.contentPrimary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
  xs: { fontSize: type.fontXs, lineHeight: type.leadingXs },
  sm: { fontSize: type.fontSm, lineHeight: type.leadingSm },
  lg: { fontSize: type.fontLg, lineHeight: type.leadingLg },
  secondary: { color: role.contentSecondary },
  tertiary: { color: role.contentTertiary },
  medium: { fontWeight: 500 },
  semibold: { fontWeight: 600 },
  mono: {
    fontFamily: type.fontMono,
    fontSize: type.fontCode,
    lineHeight: type.leadingCode,
    fontVariantLigatures: "none",
  },
  truncate: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  alignStart: { textAlign: "start" },
  alignCenter: { textAlign: "center" },
  alignEnd: { textAlign: "end" },
});

const textAligns = {
  start: text.alignStart,
  center: text.alignCenter,
  end: text.alignEnd,
} as const;

export function Text({
  size = "base",
  tone = "primary",
  weight = "normal",
  mono = false,
  truncate = false,
  align,
  children,
}: {
  readonly size?: "xs" | "sm" | "base" | "lg";
  readonly tone?: "primary" | "secondary" | "tertiary";
  readonly weight?: "normal" | "medium" | "semibold";
  readonly mono?: boolean;
  readonly truncate?: boolean;
  readonly align?: keyof typeof textAligns;
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <p
      {...props(
        text.base,
        size !== "base" && text[size],
        tone !== "primary" && text[tone],
        weight !== "normal" && text[weight],
        mono && text.mono,
        truncate && text.truncate,
        align !== undefined && textAligns[align],
      )}
    >
      {children}
    </p>
  );
}

const code = create({
  inline: {
    paddingBlock: 1,
    paddingInline: 4,
    borderRadius: radius.control,
    backgroundColor: role.bgMutedTranslucent,
    color: role.contentPrimary,
    fontFamily: type.fontMono,
    fontSize: type.fontCode,
    fontVariantLigatures: "none",
  },
  block: {
    margin: 0,
    padding: "8px 10px",
    borderRadius: radius.card,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: role.borderSecondary,
    backgroundColor: role.bgMuted,
    color: role.contentPrimary,
    fontFamily: type.fontMono,
    fontSize: type.fontCode,
    lineHeight: type.leadingCode,
    fontVariantLigatures: "none",
    overflowX: "auto",
    whiteSpace: "pre",
  },
});

export function Code({
  block = false,
  children,
}: {
  readonly block?: boolean;
  readonly children: string;
}): ReactElement {
  return block ? (
    <pre {...props(code.block)}>
      <code>{children}</code>
    </pre>
  ) : (
    <code {...props(code.inline)}>{children}</code>
  );
}
