/**
 * The chat rail: the collapsed workbench panel beside a chat
 * (`packages/app/src/workbench/workbench.tsx`, `FloatingWorkbenchPanel`).
 * The proposal adds what the chat has cost, how full its context is, and where
 * it is working, so the composer can drop its context gauge.
 */
import { create, props } from "@stylexjs/stylex";
import { useState, type ReactElement, type ReactNode } from "react";
import { workbenchStyles } from "@nyte-ai/app/workbench/workbench.stylex.ts";
import { workbench } from "@nyte-ai/app/theme/schema.stylex.ts";
import { Button } from "@nyte-ai/ui/button";
import { Icon, type IconName } from "@nyte-ai/ui/icon";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "@nyte-ai/ui/menu";
import { Row } from "@nyte-ai/ui/row";
import { radius } from "@nyte-ai/ui/schema.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { SCENARIOS, type ChatHead, type ChatRailState, type TabKind } from "./fixtures";

const WARN_PERCENT = 80;

const TAB_ICONS = {
  changes: "git-branch",
  files: "file",
  browser: "globe",
  terminal: "console",
} as const satisfies Record<TabKind, IconName>;

function formatCost(dollars: number): string {
  if (dollars === 0) return "$0.00";
  if (dollars < 0.01) return "<$0.01";
  if (dollars < 100) return `$${dollars.toFixed(2)}`;

  return `$${String(Math.round(dollars))}`;
}

function formatTokens(tokens: number): string {
  if (tokens < 1_000) return String(tokens);
  if (tokens < 1_000_000) return `${String(Math.round(tokens / 1_000))}k`;

  return `${String(Math.round(tokens / 100_000) / 10)}M`;
}

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/** Tracks the leading lane at 14px; the arc is the context in use. */
function ContextRing({ percent }: { readonly percent: number }): ReactElement {
  const circumference = 2 * Math.PI * 5;

  return (
    <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden {...props(styles.ring)}>
      <circle
        cx={7}
        cy={7}
        r={5}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        opacity={0.25}
      />
      <circle
        cx={7}
        cy={7}
        r={5}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeDasharray={`${String((Math.max(percent, 3) / 100) * circumference)} ${String(circumference)}`}
      />
    </svg>
  );
}

function DoubleChevron({ back = false }: { readonly back?: boolean }): ReactElement {
  return (
    <span {...props(workbenchStyles.doubleChevron, back && workbenchStyles.doubleChevronBack)}>
      <Icon name="chevron-right" size={11} />
      <span {...props(workbenchStyles.doubleChevronTrail)}>
        <Icon name="chevron-right" size={11} />
      </span>
    </span>
  );
}

function CollapseButton(): ReactElement {
  return (
    <Button
      size="sm"
      iconOnly
      aria-label="Collapse workbench"
      xstyle={workbenchStyles.chevronLayout}
    >
      <DoubleChevron />
    </Button>
  );
}

/** The shipped row, plus a quiet tone for empty states and a trailing detail. */
function RailRow({
  icon,
  leading,
  label,
  detail,
  quiet = false,
  primary = false,
  trigger,
  actions,
  children,
}: {
  readonly icon?: IconName;
  readonly leading?: ReactNode;
  readonly label: string;
  readonly detail?: string;
  readonly quiet?: boolean;
  /** A value rather than a place: reads in the primary ink. */
  readonly primary?: boolean;
  /** Swaps the primary button for a menu or tooltip trigger. */
  readonly trigger?: ReactElement;
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <Row interactive xstyle={workbenchStyles.railRow}>
      <Row.Primary render={trigger}>
        <Row.Leading>
          {leading ?? (icon !== undefined && <Icon name={icon} size={14} />)}
        </Row.Leading>
        <Row.Label
          xstyle={[workbenchStyles.railLabel, primary && styles.value, quiet && styles.quiet]}
        >
          {label}
        </Row.Label>
        {detail !== undefined && <span {...props(styles.detail)}>· {detail}</span>}
        {children}
      </Row.Primary>
      {actions !== undefined && <Row.Actions>{actions}</Row.Actions>}
    </Row>
  );
}

function CostRow({
  state,
  actions,
}: {
  readonly state: ChatRailState;
  readonly actions?: ReactNode;
}): ReactElement {
  const { usage } = state;
  const row = (
    <RailRow
      icon="speed-low"
      label={formatCost(usage.cost)}
      primary={usage.cost > 0}
      quiet={usage.cost === 0}
      trigger={<TooltipTrigger />}
      actions={actions}
    />
  );

  return (
    <Tooltip>
      {row}
      <TooltipContent side="left" align="start">
        <span {...props(styles.tip)}>
          <span {...props(styles.tipTitle)}>Estimated at API prices</span>
          <span {...props(styles.tipGrid)}>
            {[
              ["Input", formatTokens(usage.input)],
              ["Output", formatTokens(usage.output)],
              ["Cache read", formatTokens(usage.cacheRead)],
              ["Cache write", formatTokens(usage.cacheWrite)],
              ["Turns", String(usage.turns)],
            ].map(([name, value]) => (
              <span key={name} {...props(styles.tipLine)}>
                <span>{name}</span>
                <span>{value}</span>
              </span>
            ))}
          </span>
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

function ContextRow({ state }: { readonly state: ChatRailState }): ReactElement {
  const percent = Math.round((state.context.tokens / state.context.window) * 100);
  const warn = percent >= WARN_PERCENT;

  return (
    <div {...props(warn && intent.warning)}>
      <RailRow
        leading={<ContextRing percent={percent} />}
        label={`${String(percent)}% used`}
        detail={`${formatTokens(state.context.tokens)} / ${formatTokens(state.context.window)}`}
        primary={!warn}
      />
    </div>
  );
}

function WorktreeRow({ state }: { readonly state: ChatRailState }): ReactElement {
  const [worktree, setWorktree] = useState(state.worktree);

  return (
    <Menu>
      <RailRow icon="layers" label={worktree} primary trigger={<MenuTrigger />}>
        <span {...props(styles.caret)}>
          <Icon name="chevron-down" size={11} />
        </span>
      </RailRow>
      <MenuContent align="start">
        <MenuRadioGroup value={worktree} onValueChange={(value: string) => setWorktree(value)}>
          {state.worktrees.map((name) => (
            <MenuRadioItem key={name} value={name} icon="layers">
              {name}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuItem icon="plus">New Worktree</MenuItem>
      </MenuContent>
    </Menu>
  );
}

function headCopy(head: ChatHead): { label: string; detail?: string; quiet: boolean } {
  switch (head.kind) {
    case "none":
      return { label: "No branch", detail: `Based on ${head.base}`, quiet: true };
    case "detached":
      return { label: "Detached", detail: head.oid, quiet: true };
    case "branch": {
      if (head.name === head.base) return { label: head.name, quiet: false };

      const drift = [
        head.ahead > 0 ? `${String(head.ahead)} ahead` : undefined,
        head.behind > 0 ? `${String(head.behind)} behind` : undefined,
      ].filter((part) => part !== undefined);

      return {
        label: head.name,
        detail: drift.length === 0 ? `Based on ${head.base}` : `${drift.join(", ")} ${head.base}`,
        quiet: false,
      };
    }
    default: {
      const _exhaustive: never = head;

      return _exhaustive;
    }
  }
}

function BranchRow({ head }: { readonly head: ChatHead }): ReactElement {
  const copy = headCopy(head);

  return <RailRow icon="git-branch" label={copy.label} detail={copy.detail} quiet={copy.quiet} />;
}

function ChangesRow({ state }: { readonly state: ChatRailState }): ReactElement {
  const { changes } = state;

  if (changes.files === 0) return <RailRow icon="file" label="No changes" quiet />;

  return (
    <RailRow icon="file" label={plural(changes.files, "file")}>
      <span
        aria-label={`${String(changes.added)} added, ${String(changes.removed)} removed`}
        {...props(workbenchStyles.railStats)}
      >
        {changes.added > 0 && (
          <span {...props(intent.success, workbenchStyles.railAdded)}>+{changes.added}</span>
        )}
        {changes.removed > 0 && (
          <span {...props(intent.danger, workbenchStyles.railRemoved)}>−{changes.removed}</span>
        )}
      </span>
    </RailRow>
  );
}

function EnvironmentHeading({ initial }: { readonly initial: string }): ReactElement {
  const [environment, setEnvironment] = useState(initial);

  return (
    <div {...props(workbenchStyles.railHeading)}>
      <Menu>
        <MenuTrigger {...props(styles.headingTrigger)}>
          <span {...props(workbenchStyles.railHeadingText)}>On {environment}</span>
          <Icon name="chevron-down" size={11} />
        </MenuTrigger>
        <MenuContent align="start">
          <MenuRadioGroup
            value={environment}
            onValueChange={(value: string) => setEnvironment(value)}
          >
            <MenuRadioItem value="This Mac" icon="laptop">
              This Mac
            </MenuRadioItem>
            <MenuRadioItem value="devbox" icon="cloud">
              devbox
            </MenuRadioItem>
          </MenuRadioGroup>
          <MenuSeparator />
          <MenuItem icon="server">Environments…</MenuItem>
        </MenuContent>
      </Menu>
    </div>
  );
}

function OpenTabs({
  state,
  heading,
}: {
  readonly state: ChatRailState;
  readonly heading?: ReactNode;
}): ReactElement | null {
  if (state.tabs.length === 0 && heading === undefined) return null;

  return (
    <section {...props(workbenchStyles.railSection)}>
      <div {...props(workbenchStyles.railHeading)}>
        <span {...props(workbenchStyles.railHeadingText)}>Open Tabs</span>
        {heading}
      </div>
      {state.tabs.map((tab) => (
        <RailRow key={tab.label} icon={TAB_ICONS[tab.kind]} label={tab.label} />
      ))}
    </section>
  );
}

/** Today's panel, for comparison. The gauge lives in the composer. */
function ShippedRail({ state }: { readonly state: ChatRailState }): ReactElement {
  return (
    <nav aria-label="Workbench navigation" {...props(workbenchStyles.rail)}>
      <OpenTabs state={state} heading={<CollapseButton />} />
      <section {...props(workbenchStyles.railSection)}>
        <div {...props(workbenchStyles.railHeading)}>
          <span {...props(workbenchStyles.railHeadingText)}>On {state.environment}</span>
        </div>
        <RailRow icon="git-branch" label="Changes" />
        <RailRow icon="file" label="Files" />
        <RailRow icon="globe" label="Browser" />
        <RailRow icon="console" label="Terminal" />
      </section>
    </nav>
  );
}

function ProposedRail({ state }: { readonly state: ChatRailState }): ReactElement {
  return (
    <nav aria-label="Workbench navigation" {...props(workbenchStyles.rail)}>
      <section {...props(workbenchStyles.railSection)}>
        <CostRow state={state} actions={<CollapseButton />} />
        <ContextRow state={state} />
        <WorktreeRow state={state} />
        <BranchRow head={state.head} />
        <ChangesRow state={state} />
      </section>
      <hr {...props(styles.divider)} />
      <OpenTabs state={state} />
      <section {...props(workbenchStyles.railSection)}>
        <EnvironmentHeading initial={state.environment} />
        <RailRow icon="folder" label="Files" />
        <RailRow icon="globe" label="Browser" />
        <RailRow icon="console" label="Terminal" />
        <RailRow icon="mcp" label="MCP" />
        <RailRow icon="cube" label="Plugins" />
        <RailRow icon="skills" label="Skills" />
        <RailRow icon="brackets" label="LSP" />
      </section>
    </nav>
  );
}

const SHIPPED = SCENARIOS[2];

export function ChatRailPage(): ReactElement {
  return (
    <main {...props(styles.page)}>
      <header {...props(styles.pageHeader)}>
        <h1 {...props(styles.pageTitle)}>Chat rail</h1>
        <p {...props(styles.pageNote)}>
          The collapsed workbench beside a chat, carrying cost, context, worktree, branch and
          changes. Hover the cost for its breakdown; the worktree and environment open menus.
        </p>
      </header>
      <div {...props(styles.grid)}>
        {SHIPPED !== undefined && (
          <section {...props(styles.cell)}>
            <div {...props(styles.cellHead)}>
              <span {...props(styles.index)}>00</span>
              <h2 {...props(styles.cellTitle)}>Shipped</h2>
            </div>
            <p {...props(styles.cellNote)}>
              Today's panel. Context sits in the composer as a bare 64%.
            </p>
            <div {...props(styles.panel)}>
              <ShippedRail state={SHIPPED} />
            </div>
          </section>
        )}
        {SCENARIOS.map((state, index) => (
          <section key={state.title} {...props(styles.cell)}>
            <div {...props(styles.cellHead)}>
              <span {...props(styles.index)}>{String(index + 1).padStart(2, "0")}</span>
              <h2 {...props(styles.cellTitle)}>{state.title}</h2>
            </div>
            <p {...props(styles.cellNote)}>{state.note}</p>
            <div {...props(styles.panel)}>
              <ProposedRail state={state} />
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

const styles = create({
  page: {
    minHeight: "100vh",
    paddingBlock: "48px 120px",
    paddingInline: 40,
    backgroundColor: role.bgChrome,
    color: role.contentPrimary,
    fontFamily: type.fontSans,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
  pageHeader: { display: "flex", flexDirection: "column", gap: 4, marginBlockEnd: 32 },
  pageTitle: { margin: 0, fontSize: type.fontLg, fontWeight: 600, lineHeight: type.leadingLg },
  pageNote: { maxWidth: 640, margin: 0, color: role.contentSecondary, textWrap: "pretty" },
  grid: {
    display: "grid",
    gridTemplateColumns: `repeat(auto-fill, minmax(calc(${workbench.railWidth} + 32px), 1fr))`,
    gap: 32,
    alignItems: "start",
  },
  cell: { display: "flex", flexDirection: "column", gap: 8, minWidth: 0 },
  cellHead: { display: "flex", alignItems: "baseline", gap: 8 },
  index: {
    color: role.contentTertiary,
    fontFamily: type.fontMono,
    fontSize: type.fontXs,
    fontVariantNumeric: "tabular-nums",
  },
  cellTitle: { margin: 0, fontSize: type.fontBase, fontWeight: 600 },
  cellNote: {
    margin: 0,
    minHeight: 40,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    textWrap: "pretty",
  },
  panel: {
    display: "flex",
    width: workbench.railWidth,
    height: 480,
    overflow: "hidden",
    borderRadius: radius.card,
    backgroundColor: role.bgBase,
    boxShadow: `0 0 0 1px ${role.borderPrimary}`,
  },

  value: { color: role.contentPrimary, fontVariantNumeric: "tabular-nums" },
  quiet: { color: role.contentTertiary },
  detail: {
    minWidth: 0,
    overflow: "hidden",
    color: role.contentTertiary,
    fontVariantNumeric: "tabular-nums",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  caret: { display: "inline-flex", flexShrink: 0, color: role.contentTertiary },
  ring: { flexShrink: 0, transform: "rotate(-90deg)" },
  divider: {
    height: 1,
    margin: 0,
    marginInline: 6,
    borderStyle: "none",
    backgroundColor: role.borderSecondaryTranslucent,
  },
  headingTrigger: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    minWidth: 0,
    padding: 0,
    borderStyle: "none",
    backgroundColor: "transparent",
    color: { default: role.contentSecondary, ":hover": role.contentPrimary },
    font: "inherit",
    cursor: "pointer",
  },

  tip: { display: "flex", flexDirection: "column", gap: 6, minWidth: 168 },
  tipTitle: { fontWeight: 500 },
  tipGrid: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    color: role.contentSecondary,
    fontVariantNumeric: "tabular-nums",
  },
  tipLine: { display: "flex", justifyContent: "space-between", gap: 16 },
});
