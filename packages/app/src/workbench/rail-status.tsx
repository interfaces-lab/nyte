import { props } from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { SessionId, VcsHead } from "@nyte-ai/protocol";
import type { Usage } from "@nyte-ai/schema";
import { Icon } from "@nyte-ai/ui/icon";
import type { IconName } from "@nyte-ai/ui/icon";
import { Row } from "@nyte-ai/ui/row";
import { intent } from "@nyte-ai/ui/surface-theme";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { formatTokens, formatUsd } from "../chrome/usage-view.ts";
import { useSessionSnapshot } from "../queries.ts";
import { isSettingsSection } from "../settings/index.ts";
import type { ChangeScopeStats } from "./change-scopes.ts";
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
    <Row xstyle={workbenchStyles.railRow}>
      <Row.Leading>
        <Icon name={icon} size={14} />
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
    usage.cost.total > 0 ? "Estimated at API prices" : `${formatTokens(usage.totalTokens)} tokens`,
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

  if (usage === undefined || usage.totalTokens === 0)
    return <StatusRow icon="speed-low" label="No usage yet" quiet actions={actions} />;

  // A model without a price records tokens and a zero cost.
  const label =
    usage.cost.total > 0
      ? formatUsd(usage.cost.total)
      : `${formatTokens(usage.totalTokens)} tokens`;

  return (
    <Tooltip>
      <Row interactive xstyle={workbenchStyles.railRow}>
        <Row.Primary
          render={<TooltipTrigger />}
          onClick={
            isSettingsSection("usage")
              ? () => void navigate({ to: "/settings/$section", params: { section: "usage" } })
              : undefined
          }
        >
          <Row.Leading>
            <Icon name="speed-low" size={14} />
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

/** What the chat has spent and how full its context is. */
export function SessionStatusRows({
  sessionId,
  actions,
}: {
  readonly sessionId: SessionId;
  readonly actions: ReactNode;
}): ReactElement {
  const snapshot = useSessionSnapshot(sessionId);
  const context = snapshot.data?.context;
  const percent = context?.percent === undefined ? undefined : Math.round(context.percent);

  return (
    <>
      <CostRow usage={snapshot.data?.usage} actions={actions} />
      {context !== undefined && percent !== undefined && (
        <div {...props(percent >= CONTEXT_WARNING_PERCENT && intent.warning)}>
          <StatusRow
            icon="ruler"
            label={`${String(percent)}% used`}
            detail={`${formatTokens(context.estimatedTokens)} / ${formatTokens(context.contextWindow)}`}
          />
        </div>
      )}
    </>
  );
}

function headStatus(head: VcsHead) {
  switch (head.kind) {
    case "unborn":
      return { label: head.branch, detail: "No commits" };

    case "detached":
      return { label: "Detached", detail: head.oid.slice(0, 7) };

    case "attached": {
      const upstream = head.upstream;

      if (upstream !== null && (upstream.ahead > 0 || upstream.behind > 0)) {
        const drift = [
          upstream.ahead > 0 ? `↑${String(upstream.ahead)}` : undefined,
          upstream.behind > 0 ? `↓${String(upstream.behind)}` : undefined,
        ];

        return { label: head.branch, detail: drift.filter((part) => part !== undefined).join(" ") };
      }

      if (head.base !== null && head.base.name !== head.branch)
        return { label: head.branch, detail: `Based on ${head.base.name}` };

      return { label: head.branch, detail: undefined };
    }

    default: {
      const _exhaustive: never = head;

      return _exhaustive;
    }
  }
}

export function BranchRow({
  head,
  actions,
}: {
  readonly head: VcsHead;
  readonly actions?: ReactNode;
}): ReactElement {
  const status = headStatus(head);

  return (
    <StatusRow
      icon="git-branch"
      label={status.label}
      detail={status.detail}
      quiet={head.kind === "detached"}
      actions={actions}
    />
  );
}

export function ChangesRow({
  files,
  stats,
  onOpen,
}: {
  readonly files: number;
  readonly stats: ChangeScopeStats;
  readonly onOpen: () => void;
}): ReactElement {
  return (
    <Row interactive xstyle={workbenchStyles.railRow}>
      <Row.Primary onClick={onOpen}>
        <Row.Leading>
          <Icon name="diff" size={14} />
        </Row.Leading>
        <Row.Label xstyle={[workbenchStyles.railLabel, files > 0 && workbenchStyles.railValue]}>
          {files === 0
            ? "No changes"
            : `${String(files)} changed ${files === 1 ? "file" : "files"}`}
        </Row.Label>
        {(stats.added > 0 || stats.removed > 0) && (
          <span
            aria-label={`${String(stats.added)} added, ${String(stats.removed)} removed`}
            {...props(workbenchStyles.railStats)}
          >
            {stats.added > 0 && (
              <span {...props(intent.success, workbenchStyles.railAdded)}>+{stats.added}</span>
            )}
            {stats.removed > 0 && (
              <span {...props(intent.danger, workbenchStyles.railRemoved)}>-{stats.removed}</span>
            )}
          </span>
        )}
      </Row.Primary>
    </Row>
  );
}
