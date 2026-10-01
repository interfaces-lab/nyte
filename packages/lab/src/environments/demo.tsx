import { intent } from "@nyte-ai/ui/surface-theme";
import { props } from "@stylexjs/stylex";
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
      <span {...props(styles.crumbs)}>
        <span {...props(styles.crumbTitle)}>Environments</span>
      </span>
    );

  if (row === undefined)
    return (
      <span {...props(styles.crumbs)}>
        <span {...props(styles.crumbTitle)}>New chat</span>
      </span>
    );

  const elsewhere = row.environment.id !== home;

  return (
    <span {...props(styles.crumbs)}>
      {elsewhere && (
        <>
          <span {...props(styles.crumb)}>
            <Icon name={row.environment.icon} size={12} />
            {row.environment.name}
            {!row.environment.online && " · offline"}
          </span>
          <span {...props(styles.crumbDivider)}>/</span>
        </>
      )}
      {row.folder !== undefined && (
        <>
          <span {...props(styles.crumb)}>{row.folder}</span>
          <span {...props(styles.crumbDivider)}>/</span>
        </>
      )}
      <span title={row.title} {...props(styles.crumbTitle)}>
        {row.title}
      </span>
    </span>
  );
}

function Thread({ row }: { readonly row: LabRow }): ReactElement {
  const offline = !row.environment.online;

  return (
    <div {...props(styles.thread)}>
      <div {...props(styles.transcript)}>
        <div {...props(styles.userTurn)}>
          <div {...props(bubbleStyles.default)}>{row.title}</div>
        </div>
        <div {...props(styles.step)}>
          <Icon name="file-text" size={13} />
          Read 6 files, edited 2
        </div>
        {row.mark === "waiting" && (
          <div {...props(styles.reply)}>
            Two wordings fit the pairing screen.{" "}
            <span {...props([intent.warning, styles.ask])}>{row.ask}</span>
          </div>
        )}
        {row.mark === "failed" && (
          <div {...props(styles.reply, [intent.danger, styles.failed])}>{row.ask}</div>
        )}
        {(row.mark === "working" || row.mark === "retry") && (
          <div {...props(styles.step)}>
            <StatusDot mark="working" />
            Working
          </div>
        )}
        {row.mark === "idle" && (
          <div {...props(styles.reply)}>Done. The change is ready for review.</div>
        )}
      </div>
      <div {...props(styles.dock)}>
        <div {...props(styles.composer, offline && styles.composerDisabled)}>
          <span>{offline ? `${row.environment.name} is offline` : "Reply"}</span>
          <span {...props(styles.send)}>
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
    <div {...props(styles.window)}>
      <div {...props(styles.titlebar)}>
        <span {...props(styles.lights)}>
          <span {...props(styles.light)} />
          <span {...props(styles.light)} />
          <span {...props(styles.light)} />
        </span>
        <Crumbs row={selected} home={home} environmentsOpen={environmentsOpen} />
      </div>
      <div {...props(styles.body)}>
        <EnvironmentSidebar
          environments={environments}
          home={home}
          selected={selected?.title}
          environmentsOpen={environmentsOpen}
          onSelect={onSelect}
          onNewChat={onNewChat}
          onOpenEnvironments={onOpenEnvironments}
        />
        <div {...props(styles.main)}>
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
