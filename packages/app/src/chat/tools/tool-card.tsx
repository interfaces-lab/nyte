import { create, props } from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { Icon } from "@nyte-ai/ui/icon";
import type { IconName } from "@nyte-ai/ui/icon";
import { Spinner } from "@nyte-ai/ui/spinner";
import { focus } from "@nyte-ai/ui/styles/a11y.stylex";
import { hairline } from "@nyte-ai/ui/styles/hairline.stylex";
import { control, glyph, media, radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { motion, role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { activityStyles } from "../transcript/activity.stylex.ts";

const COLOR = {
  transitionProperty: "color, background-color",
  transitionDuration: {
    default: motion.durationFast,
    "@media (prefers-reduced-motion: reduce)": "0s",
  },
  transitionTimingFunction: motion.easeOut,
} as const;

export const toolCardStyles = create({
  glyph: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: glyph.sm,
    height: glyph.sm,
  },
  glyphXs: { width: glyph.xs, height: glyph.xs },
  hang: { paddingInlineStart: `calc(${glyph.sm} + ${space.s1_5})` },
  line: {
    display: "flex",
    alignItems: "center",
    gap: space.s1_5,
    minWidth: 0,
    minHeight: control.heightSm,
    color: role.contentSecondary,
    whiteSpace: "nowrap",
  },
  stack: { display: "flex", flexDirection: "column", minWidth: 0 },
  verb: { flexShrink: 0, color: role.contentSecondary },
  subject: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    color: role.contentPrimary,
  },
  muted: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    color: role.contentTertiary,
  },
  aside: { flexShrink: 0, color: role.contentTertiary, fontVariantNumeric: "tabular-nums" },
  mono: {
    margin: 0,
    fontFamily: type.fontMono,
    fontSize: type.fontCode,
    lineHeight: type.leadingSm,
    letterSpacing: "normal",
    color: role.contentSecondary,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    userSelect: "text",
  },
  failure: { margin: 0, color: role.contentSecondary, whiteSpace: "pre-wrap" },
  card: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    marginBlock: space.s0_5,
    overflow: "clip",
    borderRadius: radius.control,
    backgroundColor: role.bgBase,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: space.s1_5,
    width: "100%",
    minWidth: 0,
    minHeight: control.heightMd,
    paddingBlock: space.s1,
    paddingInline: space.s2,
    color: role.contentSecondary,
    whiteSpace: "nowrap",
    userSelect: "none",
    backgroundColor: {
      default: "transparent",
      ":hover": { [media.hover]: role.fillTertiary },
    },
    "--_chevron": {
      default: role.contentQuaternary,
      ":hover": { [media.hover]: role.contentTertiary },
    },
    ...COLOR,
  },
  still: { cursor: "default", backgroundColor: "transparent" },
  title: { display: "flex", alignItems: "baseline", gap: space.s1, flex: 1, minWidth: 0 },
  chevron: { display: "inline-flex", flexShrink: 0, color: "var(--_chevron)", ...COLOR },
});

export function ToolVerb({
  running,
  children,
}: {
  readonly running: boolean;
  readonly children: ReactNode;
}): ReactElement {
  return <span {...props(toolCardStyles.verb, running && activityStyles.shimmer)}>{children}</span>;
}

const BRANDS = new Map<string, { readonly icon: IconName; readonly label?: string }>([
  ["linear", { icon: "linear", label: "Linear" }],
  ["github", { icon: "github", label: "GitHub" }],
  ["github.com", { icon: "github" }],
  ["slack", { icon: "slack", label: "Slack" }],
  ["react.dev", { icon: "react" }],
  ["cloudflare", { icon: "cloudflare", label: "Cloudflare" }],
]);

export function brandName(name: string): string {
  return BRANDS.get(name)?.label ?? name;
}

export function ToolMark({
  name,
  fallback,
  small = false,
}: {
  readonly name: string;
  readonly fallback: IconName;
  readonly small?: boolean;
}): ReactElement {
  return (
    <span aria-hidden="true" {...props(toolCardStyles.glyph, small && toolCardStyles.glyphXs)}>
      <Icon name={BRANDS.get(name)?.icon ?? fallback} size={small ? "xs" : "sm"} />
    </span>
  );
}

export function ToolSpinner(): ReactElement {
  return (
    <span {...props(toolCardStyles.glyph)}>
      <Spinner />
    </span>
  );
}

export function ToolCard({
  label,
  lead,
  running,
  spins = true,
  title,
  aside,
  preview,
  onOpenChange,
  children,
}: {
  readonly label: string;
  readonly lead: ReactNode;
  readonly running: boolean;
  readonly spins?: boolean;
  readonly title: ReactNode;
  readonly aside?: ReactNode;
  readonly preview?: ReactNode;
  readonly onOpenChange?: (open: boolean) => void;
  readonly children?: ReactNode;
}): ReactElement {
  const header = (
    <>
      {running && spins ? <ToolSpinner /> : lead}
      <span {...props(toolCardStyles.title)}>{title}</span>
      {aside !== undefined && <span {...props(toolCardStyles.aside)}>{aside}</span>}
    </>
  );

  if (children === undefined) {
    return (
      <div role="group" aria-label={label} {...props(toolCardStyles.card, hairline.ring)}>
        <div {...props(toolCardStyles.header, toolCardStyles.still)}>{header}</div>
        {preview}
      </div>
    );
  }

  return (
    <Collapsible.Root onOpenChange={onOpenChange}>
      <div role="group" aria-label={label} {...props(toolCardStyles.card, hairline.ring)}>
        <Collapsible.Trigger variant="plain" xstyle={[toolCardStyles.header, focus.ringInset]}>
          {header}
          <span aria-hidden="true" {...props(toolCardStyles.chevron)}>
            <Icon name="chevron-up-down" size="xs" />
          </span>
        </Collapsible.Trigger>
        {preview}
        <Collapsible.Panel data-tool-body>
          <div {...props(toolCardStyles.stack, hairline.blockStart)}>{children}</div>
        </Collapsible.Panel>
      </div>
    </Collapsible.Root>
  );
}
