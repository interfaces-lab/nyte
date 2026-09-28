import * as stylex from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { bubbleStyles } from "@nyte-ai/app/conversation/styles.stylex.ts";
import { StatusDot } from "@nyte-ai/app/components/ui.tsx";
import { Icon } from "@nyte-ai/ui/icon";
import { EnvironmentsSurface } from "./environments-page";
import type { LabEnvironment, LabRow } from "./fixtures";
import { EnvironmentSidebar } from "./sidebar";
import { NewChat } from "./new-chat";
import { demoStyles as styles } from "./demo.stylex";

/** The titlebar names the machine and folder ahead of the title, and only when it's elsewhere. */
function Crumbs({
  row,
  home,
  environmentsOpen,
}: {
  readonly row: LabRow | undefined;
  readonly home: string | undefined;
  readonly environmentsOpen: boolean;
}): ReactElement {
  if (environmentsOpen)
    return (
      <span {...stylex.props(styles.crumbs)}>
        <span {...stylex.props(styles.crumbTitle)}>Environments</span>
      </span>
    );

  if (row === undefined)
    return (
      <span {...stylex.props(styles.crumbs)}>
        <span {...stylex.props(styles.crumbTitle)}>New chat</span>
      </span>
    );

  const elsewhere = row.environment.id !== home;

  return (
    <span {...stylex.props(styles.crumbs)}>
      {elsewhere && (
        <>
          <span {...stylex.props(styles.crumb)}>
            <Icon name={row.environment.icon} size={12} />
            {row.environment.name}
            {!row.environment.online && " · offline"}
          </span>
          <span {...stylex.props(styles.crumbDivider)}>/</span>
        </>
      )}
      {row.folder !== undefined && (
        <>
          <span {...stylex.props(styles.crumb)}>{row.folder}</span>
          <span {...stylex.props(styles.crumbDivider)}>/</span>
        </>
      )}
      <span title={row.title} {...stylex.props(styles.crumbTitle)}>
        {row.title}
      </span>
    </span>
  );
}

function Thread({ row }: { readonly row: LabRow }): ReactElement {
  const offline = !row.environment.online;

  return (
    <div {...stylex.props(styles.thread)}>
      <div {...stylex.props(styles.transcript)}>
        <div {...stylex.props(styles.userTurn)}>
          <div {...stylex.props(bubbleStyles.default)}>{row.title}</div>
        </div>
        <div {...stylex.props(styles.step)}>
          <Icon name="file-text" size={13} />
          Read 6 files, edited 2
        </div>
        {row.mark === "waiting" && (
          <div {...stylex.props(styles.reply)}>
            Two wordings fit the pairing screen.{" "}
            <span {...stylex.props(styles.ask)}>{row.ask}</span>
          </div>
        )}
        {row.mark === "failed" && (
          <div {...stylex.props(styles.reply, styles.failed)}>{row.ask}</div>
        )}
        {(row.mark === "working" || row.mark === "retry") && (
          <div {...stylex.props(styles.step)}>
            <StatusDot mark="working" />
            Working
          </div>
        )}
        {row.mark === "idle" && (
          <div {...stylex.props(styles.reply)}>Done. The change is ready for review.</div>
        )}
      </div>
      <div {...stylex.props(styles.dock)}>
        <div {...stylex.props(styles.composer, offline && styles.composerDisabled)}>
          <span>{offline ? `${row.environment.name} is offline` : "Reply"}</span>
          <span {...stylex.props(styles.send)}>
            <Icon name="arrow-up" size={14} />
          </span>
        </div>
      </div>
    </div>
  );
}

export function EnvironmentDemo({
  environments,
  home,
  current,
  onChooseEnvironment,
  selected,
  onSelect,
  environmentsOpen,
  onNewChat,
  onOpenEnvironments,
}: {
  readonly environments: readonly LabEnvironment[];
  readonly home: string | undefined;
  readonly current: LabEnvironment;
  readonly onChooseEnvironment: (environmentId: string) => void;
  readonly selected: LabRow | undefined;
  readonly onSelect: (title: string) => void;
  readonly environmentsOpen: boolean;
  readonly onNewChat: () => void;
  readonly onOpenEnvironments: () => void;
}): ReactElement {
  return (
    <div {...stylex.props(styles.window)}>
      <div {...stylex.props(styles.titlebar)}>
        <span {...stylex.props(styles.lights)}>
          <span {...stylex.props(styles.light)} />
          <span {...stylex.props(styles.light)} />
          <span {...stylex.props(styles.light)} />
        </span>
        <Crumbs row={selected} home={home} environmentsOpen={environmentsOpen} />
      </div>
      <div {...stylex.props(styles.body)}>
        <EnvironmentSidebar
          environments={environments}
          home={home}
          selected={selected?.title}
          environmentsOpen={environmentsOpen}
          onSelect={onSelect}
          onNewChat={onNewChat}
          onOpenEnvironments={onOpenEnvironments}
        />
        <div {...stylex.props(styles.main)}>
          {environmentsOpen ? (
            <EnvironmentsSurface environments={environments} home={home} />
          ) : selected === undefined ? (
            <NewChat environments={environments} current={current} onChange={onChooseEnvironment} />
          ) : (
            <Thread key={selected.title} row={selected} />
          )}
        </div>
      </div>
    </div>
  );
}
