import { create, props } from "@stylexjs/stylex";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { FileTypeIcon } from "@nyte-ai/ui/file-type-icon";
import { Icon } from "@nyte-ai/ui/icon";
import { media, radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { intent, surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { Tabs as UiTabs } from "@nyte-ai/ui/tabs";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { appearance, motion, role, type } from "@nyte-ai/ui/styles/vars.stylex";

type StepStatus = "done" | "current" | "todo";

const STEP_TONES = { done: intent.success, current: surfaceTheme.blue, todo: null } as const;

const steps = create({
  root: { display: "flex", flexDirection: "column", margin: 0, padding: 0, listStyle: "none" },
  item: {
    display: "grid",
    gridTemplateColumns: `${space.s5} minmax(0, 1fr)`,
    columnGap: space.s3,
    minWidth: 0,
  },
  rail: { display: "flex", flexDirection: "column", alignItems: "center" },
  marker: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: space.s5,
    height: space.s5,
    borderRadius: radius.pill,
    backgroundColor: role.fillTertiary,
    color: role.contentSecondary,
    fontWeight: type.weightSemibold,
    fontVariantNumeric: "tabular-nums",
  },
  current: { backgroundColor: role.bgInteractiveStrong, color: role.contentOnInteractiveStrong },
  done: { color: role.contentAccent },
  line: {
    flexGrow: 1,
    width: space.px,
    marginBlock: space.s1,
    backgroundColor: role.strokeTertiary,
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: space.s0_5,
    minWidth: 0,
    paddingTop: space.px,
    paddingBottom: space.s5,
  },
  bodyLast: { paddingBottom: 0 },
  title: { margin: 0, color: role.contentPrimary, fontWeight: type.weightSemibold },
  copy: { margin: 0, color: role.contentSecondary, textWrap: "pretty" },
  meta: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.s1_5,
    paddingTop: space.s1,
  },
});

/**
 * An ordered walk through a process: numbered markers on a rail, a title, the explanation and any
 * meta (a file link, a badge) under it. `status` marks done and current steps.
 */
export function Steps({
  items,
}: {
  readonly items: readonly {
    readonly title: ReactNode;
    readonly body?: ReactNode;
    readonly meta?: ReactNode;
    readonly status?: StepStatus;
  }[];
}): ReactElement {
  return (
    <ol {...props(steps.root)}>
      {items.map((item, index) => {
        const status = item.status ?? "todo";
        const last = index === items.length - 1;

        return (
          <li key={index} {...props(steps.item)}>
            <span {...props(steps.rail)}>
              <span
                {...props(
                  STEP_TONES[status],
                  text.xs,
                  steps.marker,
                  status === "current" && steps.current,
                  status === "done" && steps.done,
                )}
              >
                {status === "done" ? <Icon name="checkmark" size="xs" label="Done" /> : index + 1}
              </span>
              {last ? null : <span {...props(steps.line)} />}
            </span>
            <div {...props(steps.body, last && steps.bodyLast)}>
              <p {...props(text.base, steps.title)}>{item.title}</p>
              {item.body === undefined ? null : (
                <p {...props(text.base, steps.copy)}>{item.body}</p>
              )}
              {item.meta === undefined ? null : <div {...props(steps.meta)}>{item.meta}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const TRACK_TONES = {
  success: intent.success,
  warning: intent.warning,
  danger: intent.danger,
  neutral: null,
} as const;

const tracker = create({
  root: { display: "flex", gap: space.px, minWidth: 0 },
  cell: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: space.px,
    height: space.s6,
    borderRadius: space.px,
    backgroundColor: role.chartSeries,
    ":first-child": {
      borderStartStartRadius: radius.indicator,
      borderEndStartRadius: radius.indicator,
    },
    ":last-child": { borderStartEndRadius: radius.indicator, borderEndEndRadius: radius.indicator },
    opacity: { default: 1, ":hover": { [media.hover]: 0.72 } },
    transitionProperty: "opacity",
    transitionDuration: motion.durationFast,
  },
  idle: { backgroundColor: role.fillSecondary },
});

/** One cell per run, check or day, coloured by how it went; each names itself on hover. */
export function Tracker({
  data,
  label,
}: {
  readonly data: readonly {
    readonly tone: "success" | "warning" | "danger" | "neutral";
    readonly label: string;
  }[];
  readonly label: string;
}): ReactElement {
  return (
    <div role="list" aria-label={label} {...props(tracker.root)}>
      {data.map((entry, index) => (
        <Tooltip key={index}>
          <TooltipTrigger
            render={
              <span
                role="listitem"
                aria-label={entry.label}
                {...props(
                  TRACK_TONES[entry.tone],
                  tracker.cell,
                  entry.tone === "neutral" && tracker.idle,
                )}
              />
            }
          />
          <TooltipContent>{entry.label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

const link = create({
  root: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.3em",
    maxWidth: `calc(100% + ${space.s1})`,
    minWidth: 0,
    marginInline: `calc(${space.s0_5} * -1)`,
    paddingInline: space.s0_5,
    paddingBlock: space.s0_5,
    borderRadius: radius.indicator,
    backgroundColor: {
      default: "transparent",
      ":hover": { [media.hover]: role.fillTertiary },
    },
    color: role.contentSecondary,
    fontWeight: type.weightMedium,
    textDecoration: "none",
    verticalAlign: "middle",
    cursor: appearance.cursorInteractive,
    transitionProperty: "background-color",
    transitionDuration: {
      default: motion.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOut,
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 1,
    outlineColor: role.strokeAccent,
  },
  path: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  symbol: { color: role.contentTertiary, fontWeight: type.weightRegular },
});

/** A file in the workspace, drawn like the transcript's file mention and opened at a line. */
export function FileLink({
  path,
  line,
  symbol,
}: {
  readonly path: string;
  readonly line?: number;
  readonly symbol?: string;
}): ReactElement {
  const target = line === undefined ? path : `${path}:${String(line)}`;

  return (
    <a href={target} title={target} {...props(intent.primary, text.sm, link.root)}>
      <FileTypeIcon path={path} />
      <span {...props(link.path)}>{target}</span>
      {symbol === undefined ? null : <span {...props(text.code, link.symbol)}>{symbol}</span>}
    </a>
  );
}

const tabs = create({
  root: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0 },
  list: { width: "fit-content", maxWidth: "100%" },
});

/** Segmented tabs that hug their labels at the start, with the panel 12px under them. */
export const Tabs = {
  Root: (rootProps: Omit<ComponentProps<typeof UiTabs.Root>, "variant" | "xstyle">) => (
    <UiTabs.Root {...rootProps} variant="segmented" xstyle={tabs.root} />
  ),
  List: ({ children }: { readonly children?: ReactNode }): ReactElement => (
    <UiTabs.List xstyle={tabs.list}>{children}</UiTabs.List>
  ),
  Tab: UiTabs.Tab,
  Panel: UiTabs.Panel,
};
