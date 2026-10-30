import { props } from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { GitStatus, SessionId, Usage } from "@nyte-ai/sdk";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import type { IconName } from "@nyte-ai/ui/icon";
import { Row } from "@nyte-ai/ui/row";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import type { ClientCapabilities } from "../contract/client-actions.ts";
import { formatTokens, formatUsd } from "../lib/format.ts";
import { sessionWatch } from "../data/watches.ts";
import { useWatchSelect } from "../data/watch-store.ts";
import { useVcsSnapshot } from "../data/vcs.ts";
import { usePaneControllerSnapshot } from "../panes/pane-context.tsx";
import { activeSelection } from "../panes/pane-layout.ts";
import { showsSettingsSection } from "../settings/index.ts";
import { branchReadout, changesSummary } from "./changes/change-scopes.ts";
import { ChangeStats } from "./changes/change-stats.tsx";
import { launch, openChanges } from "./commands.ts";
import { useFileTabs } from "./files/file-store.ts";
import { WORKBENCH_KINDS, workbenchLaunchers } from "./model.ts";
import type { WorkbenchScope, WorkbenchViewKey, WorkbenchViewState } from "./model.ts";
import { railModel, tabPresentation } from "./selectors.ts";
import { workbench } from "./store.ts";
import { useTerminalRuntime } from "./terminal/terminal-store.ts";
import { workbenchStyles } from "./workbench.stylex.ts";

const CONTEXT_WARNING_PERCENT = 80;

function StatusRow({
  icon,
  label,
  detail,
  quiet = false,
  actions,
  children,
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly detail?: string;
  readonly quiet?: boolean;
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <Row xstyle={[text.base, workbenchStyles.railRow]}>
      <Row.Leading>
        <Icon name={icon} size="sm" />
      </Row.Leading>
      <Row.Label xstyle={[workbenchStyles.railLabel, !quiet && workbenchStyles.railValue]}>
        {label}
      </Row.Label>
      {detail !== undefined && <span {...props(workbenchStyles.railDetail)}>{detail}</span>}
      {children}
      {actions !== undefined && (
        <Row.Actions xstyle={workbenchStyles.railActions}>{actions}</Row.Actions>
      )}
    </Row>
  );
}

function usageBreakdown(usage: Usage): string {
  const lines = [
    usage.cost.total > 0 ? "Estimated at API prices" : `${formatTokens(usage.total)} tokens`,
    `Input ${formatTokens(usage.input)} · Output ${formatTokens(usage.output)}`,
  ];

  if (usage.cacheRead > 0 || usage.cacheWrite > 0)
    lines.push(
      `Cache read ${formatTokens(usage.cacheRead)} · Write ${formatTokens(usage.cacheWrite)}`,
    );

  return lines.join("\n");
}

function CostRow({
  usage,
  actions,
}: {
  readonly usage: Usage | undefined;
  readonly actions: ReactNode;
}): ReactElement {
  const navigate = useNavigate();

  if (usage === undefined || usage.total === 0)
    return <StatusRow icon="speed-low" label="No usage yet" quiet actions={actions} />;

  const label =
    usage.cost.total > 0 ? formatUsd(usage.cost.total) : `${formatTokens(usage.total)} tokens`;

  return (
    <Tooltip>
      <Row interactive xstyle={[text.base, workbenchStyles.railRow]}>
        <Row.Primary
          render={<TooltipTrigger />}
          onClick={
            showsSettingsSection("usage")
              ? () => void navigate({ to: "/settings/$section", params: { section: "usage" } })
              : undefined
          }
        >
          <Row.Leading>
            <Icon name="speed-low" size="sm" />
          </Row.Leading>
          <Row.Label xstyle={[workbenchStyles.railLabel, workbenchStyles.railValue]}>
            {label}
          </Row.Label>
        </Row.Primary>
        <Row.Actions xstyle={workbenchStyles.railActions}>{actions}</Row.Actions>
      </Row>
      <TooltipContent side="left" align="start">
        {usageBreakdown(usage)}
      </TooltipContent>
    </Tooltip>
  );
}

function SessionStatusRows({
  sessionId,
  actions,
}: {
  readonly sessionId: SessionId;
  readonly actions: ReactNode;
}): ReactElement {
  const store = sessionWatch(sessionId);
  const context = useWatchSelect(store, (state) => state.value?.context);
  const execution = useWatchSelect(store, (state) => state.value?.execution);
  const lastRun = execution?.kind === "idle" ? execution.lastRun : null;
  const usage = lastRun?.end.kind === "completed" ? lastRun.end.usage : undefined;

  const percent =
    context === undefined || context.window === 0
      ? undefined
      : Math.round((context.tokens / context.window) * 100);

  return (
    <>
      <CostRow usage={usage} actions={actions} />
      {context !== undefined && percent !== undefined && (
        <div {...props(percent >= CONTEXT_WARNING_PERCENT && intent.warning)}>
          <StatusRow
            icon="ruler"
            label={`${String(percent)}% used`}
            detail={`${formatTokens(context.tokens)} / ${formatTokens(context.window)}`}
          />
        </div>
      )}
    </>
  );
}

type Repository = Extract<GitStatus, { readonly kind: "repository" }>;

function BranchRow({
  head,
  actions,
}: {
  readonly head: Repository;
  readonly actions?: ReactNode;
}): ReactElement | null {
  const readout = branchReadout(head);

  if (readout === undefined) return null;

  switch (readout.kind) {
    case "detached":
      return (
        <StatusRow
          icon="git-branch"
          label="Detached"
          detail={readout.label}
          quiet
          actions={actions}
        />
      );
    case "unborn":
      return (
        <StatusRow icon="git-branch" label={readout.label} detail="No commits" actions={actions} />
      );
    case "attached": {
      const drift = [
        readout.ahead > 0 ? `↑${String(readout.ahead)}` : undefined,
        readout.behind > 0 ? `↓${String(readout.behind)}` : undefined,
      ].filter((part) => part !== undefined);

      return (
        <StatusRow
          icon="git-branch"
          label={readout.label}
          detail={drift.length === 0 ? undefined : drift.join(" ")}
          actions={actions}
        />
      );
    }

    default: {
      const _exhaustive: never = readout;

      return _exhaustive;
    }
  }
}

function ChangesRow({
  head,
  onOpen,
}: {
  readonly head: Repository;
  readonly onOpen: () => void;
}): ReactElement {
  const summary = changesSummary(head);

  return (
    <Row interactive xstyle={[text.base, workbenchStyles.railRow]}>
      <Row.Primary onClick={onOpen}>
        <Row.Leading>
          <Icon name="diff" size="sm" />
        </Row.Leading>
        <Row.Label
          xstyle={[workbenchStyles.railLabel, summary.changed && workbenchStyles.railValue]}
        >
          {summary.label}
        </Row.Label>
        <ChangeStats added={summary.added} removed={summary.removed} />
      </Row.Primary>
    </Row>
  );
}

function RailRow({
  icon,
  label,
  title,
  onClick,
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly title?: string;
  readonly onClick: () => void;
}): ReactElement {
  return (
    <Row interactive xstyle={[text.base, workbenchStyles.railRow]}>
      <Row.Primary title={title} onClick={onClick}>
        <Row.Leading>
          <Icon name={icon} size="sm" />
        </Row.Leading>
        <Row.Label xstyle={workbenchStyles.railLabel}>{label}</Row.Label>
      </Row.Primary>
    </Row>
  );
}

function DoubleChevron({ back = false }: { readonly back?: boolean }): ReactElement {
  return (
    <span {...props(workbenchStyles.doubleChevron, back && workbenchStyles.doubleChevronBack)}>
      <Icon name="chevron-right" size="2xs" />
      <span {...props(workbenchStyles.doubleChevronTrail)}>
        <Icon name="chevron-right" size="2xs" />
      </span>
    </span>
  );
}

export function Rail({
  viewKey,
  view,
  scope,
  workspaceName,
  capabilities,
}: {
  readonly viewKey: WorkbenchViewKey;
  readonly view: WorkbenchViewState;
  readonly scope: WorkbenchScope;
  readonly workspaceName: string | undefined;
  readonly capabilities: ClientCapabilities;
}): ReactElement {
  const selection = activeSelection(usePaneControllerSnapshot().layout);
  const sessionId = selection.kind === "session" ? selection.sessionId : undefined;
  const terminals = useTerminalRuntime();
  const files = useFileTabs(viewKey);
  const project = scope.kind === "project";
  const vcs = useVcsSnapshot(project);
  const head = project && vcs.data?.kind === "repository" ? vcs.data : undefined;
  const statusShown = sessionId !== undefined || head !== undefined;
  const rail = railModel({ view, scope, capabilities, repository: head !== undefined });

  const collapse = (
    <Button
      size="sm"
      iconOnly
      aria-label="Collapse workbench"
      xstyle={workbenchStyles.chevronLayout}
      onClick={() => workbench.dispatch(viewKey, { kind: "toggle-collapsed" })}
    >
      <DoubleChevron />
    </Button>
  );

  return (
    <nav aria-label="Workbench navigation" {...props(workbenchStyles.rail)}>
      {statusShown && (
        <section {...props(workbenchStyles.railSection)}>
          {sessionId !== undefined && (
            <SessionStatusRows sessionId={sessionId} actions={collapse} />
          )}
          {head !== undefined && (
            <BranchRow head={head} actions={sessionId === undefined ? collapse : undefined} />
          )}
          {head !== undefined && rail.changes && (
            <ChangesRow
              head={head}
              onOpen={() => openChanges(viewKey, { kind: "uncommitted" }, null)}
            />
          )}
        </section>
      )}

      {(rail.openTabs.length > 0 || !statusShown) && (
        <section {...props(workbenchStyles.railSection)}>
          <div {...props(workbenchStyles.railHeading)}>
            <span {...props(workbenchStyles.railHeadingText)}>Open Tabs</span>
            {!statusShown && collapse}
          </div>
          {rail.openTabs.map((tab) => {
            const presentation = tabPresentation(
              tab,
              files.tabs.find((item) => item.id === tab.id),
              terminals.get(tab.id),
            );

            return (
              <RailRow
                key={tab.id}
                icon={WORKBENCH_KINDS[tab.kind].icon}
                label={presentation.label}
                title={presentation.title}
                onClick={() => workbench.dispatch(viewKey, { kind: "activate", id: tab.id })}
              />
            );
          })}
        </section>
      )}

      <section {...props(workbenchStyles.railSection)}>
        <div {...props(workbenchStyles.railHeading)}>
          <span {...props(workbenchStyles.railHeadingText)}>
            {workspaceName === undefined ? "On This Mac" : `On ${workspaceName}`}
          </span>
        </div>
        {rail.launchers.map((launcher) => (
          <RailRow
            key={launcher.kind}
            icon={launcher.icon}
            label={launcher.label}
            onClick={() => launch(viewKey, launcher.kind)}
          />
        ))}
      </section>
    </nav>
  );
}

export function CompactRail({
  viewKey,
  scope,
  capabilities,
}: {
  readonly viewKey: WorkbenchViewKey;
  readonly scope: WorkbenchScope;
  readonly capabilities: ClientCapabilities;
}): ReactElement {
  return (
    <nav aria-label="Workbench navigation" {...props(workbenchStyles.iconRail)}>
      <Button
        iconOnly
        aria-label="Expand workbench"
        onClick={() => workbench.dispatch(viewKey, { kind: "toggle-collapsed" })}
      >
        <DoubleChevron back />
      </Button>
      <span aria-hidden="true" {...props(workbenchStyles.iconRailDivider)} />
      {workbenchLaunchers(scope, capabilities).map((kind) => (
        <Button
          iconOnly
          key={kind}
          icon={WORKBENCH_KINDS[kind].icon}
          aria-label={`Open ${WORKBENCH_KINDS[kind].label}`}
          onClick={() => launch(viewKey, kind)}
        />
      ))}
    </nav>
  );
}
