/** The panes beside the timeline: the aside, an agent's own pane, and the composer. */
import { props } from "@stylexjs/stylex";
import { useRef, type ReactElement, type ReactNode } from "react";
import { workbenchStyles } from "@nyte-ai/app/workbench/workbench.stylex.ts";
import { Button } from "@nyte-ai/ui/button";
import { Icon, type IconName } from "@nyte-ai/ui/icon";
import { Input } from "@nyte-ai/ui/input";
import { intent } from "@nyte-ai/ui/surface-theme";
import { useScrollEdges } from "./tabs";
import type { Agent, ContextFile, Decision, Entry } from "./timeline";
import { styles } from "./page.stylex";
import { AgentGlyph, AgentRow } from "./rail";

export function Aside({
  icon,
  children,
}: {
  readonly icon: IconName;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div {...props(styles.aside)}>
      <span {...props(styles.asideIcon)}>
        <Icon name={icon} size={14} />
      </span>
      <span>{children}</span>
    </div>
  );
}

export function DecisionCard({
  decision,
  pending,
  onAct,
}: {
  readonly decision: Decision;
  readonly pending: boolean;
  readonly onAct: () => void;
}): ReactElement {
  return (
    <div {...props(styles.decision, pending && styles.decisionPending)}>
      <div {...props(styles.decisionHead, pending && intent.warning)}>
        <Icon name="bell" size={14} />
        <span {...props(styles.decisionQuestion)}>{decision.question}</span>
      </div>
      <p {...props(styles.decisionDetail)}>{decision.detail}</p>
      {pending ? (
        <div {...props(styles.decisionActions)}>
          <Button size="sm" variant="solid" onClick={onAct}>
            {decision.action}
          </Button>
          <span {...props(styles.decisionHint)}>or reply below</span>
        </div>
      ) : (
        <span {...props(styles.decisionHint)}>Answered</span>
      )}
    </div>
  );
}

export function EntryView({
  entry,
  agents,
  openIds,
  pending,
  onAct,
  onOpenAgent,
}: {
  readonly entry: Entry;
  readonly agents: ReadonlyMap<string, Agent>;
  readonly openIds: readonly string[];
  readonly pending: Decision | undefined;
  readonly onAct: () => void;
  readonly onOpenAgent: (id: string) => void;
}): ReactElement {
  switch (entry.kind) {
    case "you":
      return <div {...props(styles.you)}>{entry.text}</div>;
    case "coordinator":
      return (
        <div {...props(styles.coordinator)}>
          <span {...props(styles.coordinatorMark)}>
            <Icon name="agent" size={14} label="Coordinator" />
          </span>
          <p {...props(styles.coordinatorText)}>{entry.text}</p>
        </div>
      );
    case "delegated": {
      const started = entry.agents.flatMap((id) => {
        const agent = agents.get(id);

        return agent === undefined ? [] : [agent];
      });

      return (
        <div {...props(styles.delegated)}>
          <div {...props(styles.delegatedHead)}>
            <span>{entry.title}</span>
            <span {...props(styles.delegatedCount)}>
              {started.length === 1 ? "1 agent" : `${String(started.length)} agents`}
            </span>
          </div>
          {started.map((agent) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              open={openIds.includes(agent.id)}
              onOpen={() => onOpenAgent(agent.id)}
            />
          ))}
        </div>
      );
    }

    case "handled":
      return (
        <Aside icon="bubble-question">
          An agent asked “{entry.question}” Answered from <code>{entry.source}</code>:{" "}
          {entry.answer}
        </Aside>
      );
    case "archived":
      return <Aside icon="archive">{entry.text}</Aside>;
    case "signal":
      return (
        <Aside icon="pull-request">
          <span {...props(styles.asideSource)}>{entry.source}</span> · {entry.text}
        </Aside>
      );
    case "context":
      return (
        <Aside icon="file-text">
          {entry.text} in <code>{entry.path}</code>
        </Aside>
      );
    case "decision":
      return <DecisionCard decision={entry} pending={entry === pending} onAct={onAct} />;
    default: {
      const _exhaustive: never = entry;

      return _exhaustive;
    }
  }
}

export function PanelSection({
  title,
  meta,
  children,
}: {
  readonly title: string;
  readonly meta?: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section aria-label={title} {...props(workbenchStyles.railSection)}>
      <h3 {...props(workbenchStyles.railHeading, styles.panelHeading)}>
        <span {...props(workbenchStyles.railHeadingText)}>{title}</span>
        {meta !== undefined && <span {...props(styles.panelMeta)}>{meta}</span>}
      </h3>
      {children}
    </section>
  );
}

export function ContextRow({
  file,
}: {
  readonly file: ContextFile & { readonly fresh: boolean };
}): ReactElement {
  return (
    <div {...props(styles.contextRow)}>
      <span {...props(styles.contextIcon)}>
        <Icon name="file-text" size={14} />
      </span>
      <span {...props(styles.contextText)}>
        <span {...props(styles.contextPath)}>
          {file.path}
          {file.fresh && <span {...props(styles.fresh)}>Updated</span>}
        </span>
        <span {...props(styles.contextNote)}>{file.note}</span>
      </span>
    </div>
  );
}

export function FadedScroll({
  reversed = false,
  children,
}: {
  readonly reversed?: boolean;
  readonly children: ReactNode;
}): ReactElement {
  const ref = useRef<HTMLDivElement | null>(null);
  const edges = useScrollEdges(ref, "y");
  const top = reversed ? edges.fromEnd : edges.fromStart;

  return (
    <div
      ref={ref}
      {...props(styles.scroller, reversed && styles.scrollerReversed, top && styles.scrollerFaded)}
    >
      {children}
    </div>
  );
}

export function PaneHeader({
  title,
  place,
  children,
}: {
  readonly title: string;
  readonly place: "cloud" | "local";
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <header {...props(styles.paneHeader)}>
      {children}
      <span {...props(styles.paneTitle)}>{title}</span>
      <span {...props(styles.crumb)} title="Keeps running when this Mac sleeps">
        <Icon name={place === "cloud" ? "cloud" : "laptop"} size={12} />
        {place === "cloud" ? "Cloud" : "This Mac"}
      </span>
    </header>
  );
}

export function AgentPane({ agent }: { readonly agent: Agent }): ReactElement {
  return (
    <>
      <PaneHeader title={agent.task} place={agent.place}>
        <span {...props(styles.paneGlyph)}>
          <AgentGlyph agent={agent} />
        </span>
      </PaneHeader>
      <FadedScroll>
        <div {...props(styles.transcript)}>
          <div {...props(styles.coordinator)}>
            <span {...props(styles.coordinatorMark)}>
              <Icon name="agent" size={14} label="Coordinator" />
            </span>
            <p {...props(styles.coordinatorText)}>
              {agent.task}. Read <code>preferences.md</code> and <code>dialogs.md</code> first. One
              PR for the batch; keep confirm copy as written.
            </p>
          </div>
          {agent.state === "working" ? (
            <Aside icon="loader">
              Working. The coordinator will bring you anything that needs you.
            </Aside>
          ) : (
            <div {...props(styles.decision)}>
              <div {...props(styles.decisionHead)}>
                <Icon
                  name={agent.result?.startsWith("PR") === true ? "pull-request" : "checkmark"}
                  size={14}
                />
                <span {...props(styles.decisionQuestion)}>{agent.result ?? "Done"}</span>
              </div>
              <p {...props(styles.decisionDetail)}>
                {agent.state === "archived"
                  ? "Landed and put away by the coordinator. It stays here for the record."
                  : "Finished and waiting on a merge or a read."}
              </p>
            </div>
          )}
        </div>
      </FadedScroll>
    </>
  );
}

export function Composer({
  value,
  onChange,
  onSend,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSend: () => void;
}): ReactElement {
  return (
    <form
      {...props(styles.composer)}
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
    >
      <div {...props(styles.composerFrame)}>
        <Input
          variant="quiet"
          aria-label="Direct the project"
          placeholder="Direct the project"
          value={value}
          onValueChange={onChange}
          xstyle={styles.composerInput}
        />
        <div {...props(styles.composerRow)}>
          <Button size="xs" iconOnly icon="paperclip" aria-label="Attach" />
          <span {...props(styles.composerModel)}>Coordinator · Claude Opus</span>
          <span {...props(styles.composerGap)} />
          <Button
            size="sm"
            variant="solid"
            iconOnly
            icon="arrow-up"
            type="submit"
            aria-label="Send"
            disabled={value.trim() === ""}
          />
        </div>
      </div>
    </form>
  );
}
