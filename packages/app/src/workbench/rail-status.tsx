import { props } from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { GitStatus, SessionId, Usage } from "@nyte-ai/sdk";
import { Icon } from "@nyte-ai/ui/icon";
import type { IconName } from "@nyte-ai/ui/icon";
import { Row } from "@nyte-ai/ui/row";
import { intent } from "@nyte-ai/ui/surface-theme";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { formatTokens, formatUsd } from "../chrome/usage-view.ts";
import { useSessionView } from "../queries.ts";
import { isSettingsSection } from "../settings/index.ts";
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

  // A model without a price records tokens and a zero cost.
  const label =
    usage.cost.total > 0 ? formatUsd(usage.cost.total) : `${formatTokens(usage.total)} tokens`;

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

/** What the chat's last run spent and how full its context is, as its view carries them. */
export function SessionStatusRows({
  sessionId,
  actions,
}: {
  readonly sessionId: SessionId;
  readonly actions: ReactNode;
}): ReactElement {
  const view = useSessionView(sessionId);
  const context = view?.context;
  const execution = view?.execution;
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

function headStatus(head: Repository) {
  if (head.branch === null) return { label: "Detached", detail: head.head?.slice(0, 7) };

  if (head.head === null) return { label: head.branch, detail: "No commits" };
  const { upstream } = head;

  if (upstream !== null && (upstream.ahead > 0 || upstream.behind > 0)) {
    const drift = [
      upstream.ahead > 0 ? `↑${String(upstream.ahead)}` : undefined,
      upstream.behind > 0 ? `↓${String(upstream.behind)}` : undefined,
    ];

    return { label: head.branch, detail: drift.filter((part) => part !== undefined).join(" ") };
  }

  return { label: head.branch, detail: undefined };
}

export function BranchRow({
  head,
  actions,
}: {
  readonly head: Repository;
  readonly actions?: ReactNode;
}): ReactElement {
  const status = headStatus(head);

  return (
    <StatusRow
      icon="git-branch"
      label={status.label}
      detail={status.detail}
      quiet={head.branch === null}
      actions={actions}
    />
  );
}

export function ChangesRow({
  files,
  onOpen,
}: {
  readonly files: number;
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
      </Row.Primary>
    </Row>
  );
}
