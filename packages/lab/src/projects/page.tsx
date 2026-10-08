/**
 * Projects, in the desktop's shell: you talk to one coordinator, and it runs
 * the agents.
 *
 * The chrome is the app's: the titlebar with the window tabs, the sidebar on
 * the material, and the main area as a card set into it. Projects are folders
 * in the sidebar. The coordinator is the project's first tab; any agent opens
 * beside it, so ten agents are ten tabs in the titlebar, not ten rows in your
 * sidebar. The project's panel sits inside the card where the workbench does.
 *
 * The folder and the tabs borrow from define.app; the lab tray at the bottom
 * right steps the scripted coordinator and switches between the designs.
 * Reference: https://cursor.com/blog/projects
 */
import { create, props } from "@stylexjs/stylex";
import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import type { SessionMark } from "@nyte-ai/client";
import { sidebarStyles } from "@nyte-ai/app/chrome/sidebar.stylex.ts";
import { titlebarStyles } from "@nyte-ai/app/chrome/titlebar.stylex.ts";
import { StatusDot } from "@nyte-ai/app/components/ui.tsx";
import { conversation, shell, sidebar, workbench } from "@nyte-ai/app/theme/schema.stylex.ts";
import { workbenchStyles } from "@nyte-ai/app/workbench/workbench.stylex.ts";
import { Button } from "@nyte-ai/ui/button";
import { floatingSurfaceStyles } from "@nyte-ai/ui/floating-surface.stylex";
import { Icon, PanelToggleIcon, type IconName } from "@nyte-ai/ui/icon";
import { Input } from "@nyte-ai/ui/input";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@nyte-ai/ui/menu";
import { Row } from "@nyte-ai/ui/row";
import { avatar, layer, radius } from "@nyte-ai/ui/schema.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { Switch } from "@nyte-ai/ui/switch";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { motion as motionTokens, role, type } from "@nyte-ai/ui/vars.stylex";
import { Shelf } from "../sidebar/rail";
import { ProjectFolder, type FolderDesign } from "./folder";
import { TabStrip, useScrollEdges, type TabDesign, type TabItem } from "./tabs";
import {
  LOOSE_CHATS,
  OTHER_PROJECTS,
  projectAt,
  STEPS,
  type Agent,
  type ContextFile,
  type Decision,
  type Entry,
} from "./timeline";

const PROJECT = "Dialog surface migration";

const COORDINATOR = "coordinator";

const MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

const SUBSCRIPTIONS = [
  {
    source: "Follow my PRs",
    icon: "pull-request",
    detail: "Fixes CI and acts when a PR opens or merges",
  },
  { source: "#design-system", icon: "slack", detail: "Picks up bug reports from the channel" },
  { source: "Weekdays at 09:00", icon: "clock", detail: "Posts progress here" },
] as const satisfies readonly {
  readonly source: string;
  readonly icon: IconName;
  readonly detail: string;
}[];

const NEEDS_YOU_STEP = STEPS.findIndex((step) =>
  step.entries.some((entry) => entry.kind === "decision"),
);

function agentsIn(agents: ReadonlyMap<string, Agent>, state: Agent["state"]): readonly Agent[] {
  return [...agents.values()].filter((agent) => agent.state === state);
}

function stateLabel(agent: Agent): string {
  if (agent.state === "working") return "Working";

  const word = agent.state === "done" ? "Done" : "Archived";

  return agent.result === undefined ? word : `${word} · ${agent.result}`;
}

function AgentGlyph({ agent }: { readonly agent: Agent }): ReactElement {
  const glyph =
    agent.state === "working" ? (
      <StatusDot mark="working" />
    ) : (
      <Icon
        name={agent.state === "done" ? "checkmark" : "archive"}
        size={14}
        label={agent.state === "done" ? "Done" : "Archived"}
      />
    );

  // Cloud is where agents run; only the exception carries a badge, as in the sidebar.
  if (agent.place === "cloud") return glyph;

  return (
    <span title="This Mac" {...props(sidebarStyles.sessionBadgeHost)}>
      {glyph}
      <span {...props(sidebarStyles.sessionBadge)}>
        <Icon name="laptop" size={9} label="This Mac" />
      </span>
    </span>
  );
}

function AgentRow({
  agent,
  open,
  onOpen,
}: {
  readonly agent: Agent;
  readonly open: boolean;
  readonly onOpen: () => void;
}): ReactElement {
  return (
    <Row
      interactive
      selected={open}
      xstyle={[
        sidebarStyles.rowSurface,
        styles.agentRow,
        agent.state === "archived" && styles.receded,
      ]}
    >
      <Row.Primary onClick={onOpen} title="Open as a tab">
        <Row.Leading xstyle={sidebarStyles.rowIcon}>
          <AgentGlyph agent={agent} />
        </Row.Leading>
        <Row.Label>{agent.task}</Row.Label>
        {agent.result !== undefined && (
          <Row.Meta xstyle={styles.agentResult}>{agent.result}</Row.Meta>
        )}
      </Row.Primary>
    </Row>
  );
}

function ProjectRow({
  name,
  mark,
  working,
  ask,
  selected,
  folder,
}: {
  readonly name: string;
  readonly mark: SessionMark;
  readonly working: number;
  readonly ask: string | undefined;
  readonly selected: boolean;
  readonly folder: FolderDesign;
}): ReactElement {
  const [hovering, setHovering] = useState(false);

  const titleLine = (
    <>
      <Row.Label xstyle={sidebarStyles.sessionLabel}>{name}</Row.Label>
      {working > 0 && (
        <Row.Meta
          xstyle={[sidebarStyles.rowMeta, styles.projectMeta]}
          title={`${String(working)} agents working`}
        >
          {mark === "idle" ? <Icon name="agent" size={12} /> : <StatusDot mark={mark} />}
          {working}
        </Row.Meta>
      )}
    </>
  );

  return (
    <Row
      selected={selected}
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => setHovering(false)}
      xstyle={[
        sidebarStyles.rowSurface,
        sidebarStyles.sessionRow,
        selected && sidebarStyles.rowSelected,
        ask !== undefined && sidebarStyles.sessionRowAsk,
      ]}
    >
      {selected && <Row.Backdrop xstyle={sidebarStyles.sessionSelection} />}
      <Row.Primary aria-current={selected ? "page" : undefined}>
        <Row.Leading
          xstyle={[sidebarStyles.rowIcon, ask !== undefined && sidebarStyles.rowIconAsk]}
        >
          <ProjectFolder design={folder} open={selected} hovering={hovering} count={working} />
        </Row.Leading>
        {ask === undefined ? (
          titleLine
        ) : (
          <Row.Body>
            <span {...props(sidebarStyles.sessionTitleLine)}>{titleLine}</span>
            <Row.Description xstyle={[intent.warning, sidebarStyles.sessionAsk]}>
              {ask}
            </Row.Description>
          </Row.Body>
        )}
      </Row.Primary>
    </Row>
  );
}

function Rail({
  mark,
  working,
  ask,
  folder,
}: {
  readonly mark: SessionMark;
  readonly working: number;
  readonly ask: string | undefined;
  readonly folder: FolderDesign;
}): ReactElement {
  return (
    <nav aria-label="Sidebar" {...props(sidebarStyles.rail, styles.rail)}>
      <div {...props(sidebarStyles.primaryActions)}>
        <Row variant="nav" xstyle={sidebarStyles.navRow}>
          <Row.Leading xstyle={sidebarStyles.navLeading}>
            <Icon name="new-chat" size={14} />
          </Row.Leading>
          <Row.Label>New Chat</Row.Label>
        </Row>
        <Row variant="nav" xstyle={sidebarStyles.navRow}>
          <Row.Leading xstyle={sidebarStyles.navLeading}>
            <Icon name="search" size={14} />
          </Row.Leading>
          <Row.Label>Search</Row.Label>
        </Row>
      </div>
      <div {...props(sidebarStyles.scroll, styles.railScroll)}>
        <section aria-label="Projects" {...props(sidebarStyles.section)}>
          <div {...props(sidebarStyles.sectionHeader)}>
            <span {...props(sidebarStyles.sectionToggle)}>
              <span {...props(sidebarStyles.sectionLabel)}>Projects</span>
            </span>
            <Button size="xs" iconOnly icon="folder-add" aria-label="New Project" />
          </div>
          <ProjectRow
            name={PROJECT}
            mark={mark}
            working={working}
            ask={ask}
            selected
            folder={folder}
          />
          {OTHER_PROJECTS.map((project) => (
            <ProjectRow
              key={project.id}
              name={project.name}
              mark={project.working > 0 ? "working" : "idle"}
              working={project.working}
              ask={undefined}
              selected={false}
              folder={folder}
            />
          ))}
        </section>
        <Shelf
          label="Chats"
          count={LOOSE_CHATS.length}
          leading={<Icon name="new-chat" size={14} />}
        >
          {LOOSE_CHATS.map((title) => (
            <Row key={title} xstyle={[sidebarStyles.rowSurface, sidebarStyles.sessionRow]}>
              <Row.Primary>
                <Row.Leading xstyle={sidebarStyles.rowIcon} />
                <Row.Label>{title}</Row.Label>
              </Row.Primary>
            </Row>
          ))}
        </Shelf>
      </div>
    </nav>
  );
}

/** A quiet line in the transcript: something the coordinator handled so you didn't have to. */
function Aside({
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

function DecisionCard({
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

function EntryView({
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

function PanelSection({
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

function ContextRow({
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

/** The transcript's scroller: its top dissolves once there is more above, as the desktop's does. */
function FadedScroll({
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

function PaneHeader({
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

/** What an agent tab shows: enough to know what it is doing and what it made. */
function AgentPane({ agent }: { readonly agent: Agent }): ReactElement {
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

function Composer({
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

interface TabState {
  readonly open: readonly string[];
  readonly active: string;
  /** Most recent first; picks what to show when the active tab closes. */
  readonly history: readonly string[];
  readonly closed: readonly { readonly id: string; readonly index: number }[];
}

const INITIAL_TABS: TabState = {
  open: [],
  active: COORDINATOR,
  history: [COORDINATOR],
  closed: [],
};

function activate(state: TabState, id: string): TabState {
  return {
    ...state,
    active: id,
    history: [id, ...state.history.filter((entry) => entry !== id)].slice(0, 10),
  };
}

function openTab(state: TabState, id: string): TabState {
  const open = state.open.includes(id) ? state.open : [...state.open, id];

  return activate({ ...state, open }, id);
}

function closeTab(state: TabState, id: string): TabState {
  const index = state.open.indexOf(id);

  if (index === -1) return state;
  const open = state.open.filter((entry) => entry !== id);
  const history = state.history.filter((entry) => entry !== id);
  const closed = [{ id, index }, ...state.closed].slice(0, 20);

  const next =
    state.active === id
      ? (history.find((entry) => entry === COORDINATOR || open.includes(entry)) ?? COORDINATOR)
      : state.active;

  return { open, active: next, history, closed };
}

function reopenTab(state: TabState): TabState {
  const [last, ...closed] = state.closed;

  if (last === undefined) return state;
  const open = [...state.open];

  open.splice(Math.min(last.index, open.length), 0, last.id);

  return activate({ ...state, open, closed }, last.id);
}

function cycleTab(state: TabState, step: 1 | -1): TabState {
  const order = [COORDINATOR, ...state.open];
  const index = order.indexOf(state.active);
  const next = order[(index + step + order.length) % order.length];

  return next === undefined ? state : activate(state, next);
}

const FOLDER_DEFAULT: FolderDesign = { style: "paper", face: "count", pages: "stack" };

const TABS_DEFAULT: TabDesign = {
  style: "connected",
  width: "fit",
  overflow: "scroll",
  separators: true,
};

function Choice<Value extends string>({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: Value;
  readonly options: readonly { readonly value: Value; readonly label: string }[];
  readonly onChange: (value: Value) => void;
}): ReactElement {
  return (
    <label {...props(styles.choice)}>
      <span {...props(styles.choiceLabel)}>{label}</span>
      <ToggleGroup
        aria-label={label}
        value={[value]}
        onValueChange={(values) => {
          const next = options.find((option) => option.value === values.at(-1));

          if (next !== undefined) onChange(next.value);
        }}
      >
        {options.map((option) => (
          <Toggle key={option.value} value={option.value}>
            {option.label}
          </Toggle>
        ))}
      </ToggleGroup>
    </label>
  );
}

export function ProjectsPage(): ReactElement {
  const [step, setStep] = useState(NEEDS_YOU_STEP);
  const [notes, setNotes] = useState<readonly string[]>([]);
  const [draft, setDraft] = useState("");
  const [tabs, setTabs] = useState(INITIAL_TABS);
  const [folder, setFolder] = useState(FOLDER_DEFAULT);
  const [tabDesign, setTabDesign] = useState(TABS_DEFAULT);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);
  const [trayOpen, setTrayOpen] = useState(true);
  const [squareCorner, setSquareCorner] = useState(true);
  const project = projectAt(step);
  const working = agentsIn(project.agents, "working");
  const done = agentsIn(project.agents, "done");
  const archived = agentsIn(project.agents, "archived");
  const latest = STEPS[step]?.entries ?? [];

  const mark: SessionMark =
    project.pending !== undefined ? "waiting" : working.length > 0 ? "working" : "idle";

  const context = project.context.map((file) =>
    file.path === "preferences.md" && notes.length > 0
      ? { ...file, note: notes.at(-1) ?? file.note, fresh: true }
      : file,
  );

  // Tabs for agents this step has not started yet fall away with the step.
  const openIds = tabs.open.filter((id) => project.agents.has(id));

  const activeId =
    tabs.active === COORDINATOR || openIds.includes(tabs.active) ? tabs.active : COORDINATOR;

  const activeAgent = project.agents.get(activeId);
  const unopened = [...project.agents.keys()].filter((id) => !openIds.includes(id));
  const orderKey = [COORDINATOR, ...openIds].join(" ");

  const advance = (): void => setStep((current) => Math.min(current + 1, STEPS.length - 1));
  const open = (id: string): void => setTabs((current) => openTab(current, id));
  const close = (id: string): void => setTabs((current) => closeTab(current, id));
  const onCornerChange = useCallback((square: boolean) => setSquareCorner(square), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const meta = event.metaKey || event.ctrlKey;
      const digit = /^Digit([1-9])$/.exec(event.code)?.[1];

      if (event.altKey && event.key.toLowerCase() === "w") {
        event.preventDefault();
        setTabs((current) => closeTab(current, activeId));
      } else if (meta && event.shiftKey && event.key.toLowerCase() === "t") {
        event.preventDefault();
        setTabs(reopenTab);
      } else if (event.ctrlKey && event.key === "Tab") {
        event.preventDefault();
        setTabs((current) => cycleTab(current, event.shiftKey ? -1 : 1));
      } else if (meta && !event.shiftKey && !event.altKey && digit !== undefined) {
        const target = orderKey.split(" ")[Number(digit) - 1];

        if (target === undefined) return;
        event.preventDefault();
        setTabs((current) => activate(current, target));
      }
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, orderKey]);

  const send = (): void => {
    const text = draft.trim();

    if (text === "") return;
    setNotes((current) => [...current, text]);
    setDraft("");
  };

  const tabItems: readonly TabItem[] = [
    {
      id: COORDINATOR,
      title: PROJECT,
      glyph: mark === "idle" ? <Icon name="agent" size={14} /> : <StatusDot mark={mark} />,
      closable: false,
      preview: "Coordinator",
    },
    ...openIds.flatMap((id) => {
      const agent = project.agents.get(id);

      return agent === undefined
        ? []
        : [
            {
              id,
              title: agent.task,
              glyph: <AgentGlyph agent={agent} />,
              closable: true,
              preview: stateLabel(agent),
            },
          ];
    }),
  ];

  return (
    <TooltipProvider>
      <div {...props(styles.window)}>
        <header {...props(titlebarStyles.bar)}>
          <span
            {...props(titlebarStyles.sidebarSlot, !sidebarOpen && titlebarStyles.sidebarSlotHidden)}
          >
            <span aria-hidden="true" {...props(styles.lights)}>
              <span {...props(styles.light)} />
              <span {...props(styles.light)} />
              <span {...props(styles.light)} />
            </span>
            <span {...props(styles.fill)} />
            <span {...props(titlebarStyles.actionTrack)}>
              <Toggle
                iconOnly
                indicator="glyph"
                aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
                pressed={sidebarOpen}
                onPressedChange={setSidebarOpen}
              >
                <PanelToggleIcon side="left" visible={sidebarOpen} />
              </Toggle>
            </span>
            <span {...props(titlebarStyles.historyControl, titlebarStyles.historyControlBack)}>
              <Button iconOnly icon="arrow-left" aria-label="Go back" disabled />
            </span>
            <span {...props(titlebarStyles.historyControl)}>
              <Button iconOnly icon="arrow-right" aria-label="Go forward" disabled />
            </span>
          </span>
          <div {...props(titlebarStyles.contentArea, titlebarStyles.contentAreaTabbed)}>
            <span {...props(titlebarStyles.center)}>
              <TabStrip
                tabs={tabItems}
                activeId={activeId}
                design={tabDesign}
                mac={MAC}
                onActivate={(id) => setTabs((current) => activate(current, id))}
                onClose={close}
                onCloseOthers={(id) =>
                  setTabs((current) =>
                    openIds.filter((other) => other !== id).reduce(closeTab, current),
                  )
                }
                onCloseRight={(id) =>
                  setTabs((current) =>
                    openIds.slice(openIds.indexOf(id) + 1).reduce(closeTab, current),
                  )
                }
                onReorder={(ids) =>
                  setTabs((current) => ({
                    ...current,
                    open: ids.filter((id) => id !== COORDINATOR),
                  }))
                }
                onAdd={unopened[0] === undefined ? undefined : () => open(unopened[0] ?? "")}
                onCornerChange={onCornerChange}
              />
              <span {...props(titlebarStyles.actionTrack)}>
                <Menu>
                  <MenuTrigger render={<Button iconOnly icon="more" aria-label="Chat actions" />} />
                  <MenuContent align="end">
                    <MenuItem
                      icon="agent"
                      disabled={unopened.length === 0}
                      onClick={() => setTabs((current) => unopened.reduce(openTab, current))}
                    >
                      Open Every Agent
                    </MenuItem>
                    <MenuItem
                      icon="close"
                      disabled={openIds.length === 0}
                      onClick={() => setTabs((current) => openIds.reduce(closeTab, current))}
                    >
                      Close Agent Tabs
                    </MenuItem>
                  </MenuContent>
                </Menu>
              </span>
            </span>
            <span {...props(titlebarStyles.workbenchSlot)}>
              <span {...props(titlebarStyles.actionTrack)}>
                <Toggle
                  iconOnly
                  indicator="glyph"
                  aria-label={panelOpen ? "Hide project panel" : "Show project panel"}
                  pressed={panelOpen}
                  onPressedChange={setPanelOpen}
                >
                  <PanelToggleIcon side="right" visible={panelOpen} />
                </Toggle>
              </span>
            </span>
          </div>
        </header>

        <div {...props(styles.stage)}>
          {sidebarOpen && (
            <Rail
              mark={mark}
              working={working.length}
              ask={project.pending?.question}
              folder={folder}
            />
          )}
          <main
            {...props(
              styles.card,
              !sidebarOpen && styles.cardSidebarHidden,
              squareCorner && styles.cardSquare,
            )}
          >
            <section aria-label="Project pane" {...props(styles.pane)}>
              {activeAgent !== undefined ? (
                <AgentPane key={activeAgent.id} agent={activeAgent} />
              ) : (
                <>
                  <PaneHeader title={PROJECT} place="cloud">
                    <span {...props(styles.paneGlyph)}>
                      <Icon name="agent" size={14} label="Coordinator" />
                    </span>
                  </PaneHeader>
                  {/* Reversed so the newest entry holds the bottom as steps add more. */}
                  <FadedScroll reversed>
                    <div {...props(styles.transcript)}>
                      {project.entries.map((entry, index) => (
                        <EntryView
                          key={index}
                          entry={entry}
                          agents={project.agents}
                          openIds={openIds}
                          pending={project.pending}
                          onAct={advance}
                          onOpenAgent={open}
                        />
                      ))}
                      {notes.map((note, index) => (
                        <div key={`note-${String(index)}`} {...props(styles.noteGroup)}>
                          <div {...props(styles.you)}>{note}</div>
                          <Aside icon="file-text">
                            Saved to <code>preferences.md</code>. Every agent follows it from now
                            on.
                          </Aside>
                        </div>
                      ))}
                    </div>
                  </FadedScroll>
                  <Composer value={draft} onChange={setDraft} onSend={send} />
                </>
              )}
            </section>

            {panelOpen && (
              <aside
                aria-label="Project"
                {...props(workbenchStyles.panel, workbenchStyles.panelOpen, styles.panel)}
              >
                <div {...props(workbenchStyles.toolbar, styles.panelToolbar)}>
                  <span {...props(styles.panelTitle)}>Project</span>
                  <span {...props(styles.panelFacts)}>
                    {String(working.length)} working · {String(archived.length)} archived
                  </span>
                </div>
                <div {...props(styles.panelScroll)}>
                  <div {...props(workbenchStyles.rail)}>
                    <PanelSection title="Needs you">
                      {project.pending === undefined ? (
                        <p {...props(styles.quiet)}>Nothing right now.</p>
                      ) : (
                        <DecisionCard decision={project.pending} pending onAct={advance} />
                      )}
                    </PanelSection>

                    <PanelSection
                      title="Agents"
                      meta={`${String(working.length)} working · ${String(done.length)} done`}
                    >
                      <div {...props(sidebarStyles.section)}>
                        {[...working, ...done].map((agent) => (
                          <AgentRow
                            key={agent.id}
                            agent={agent}
                            open={openIds.includes(agent.id)}
                            onOpen={() => open(agent.id)}
                          />
                        ))}
                        {working.length + done.length === 0 && (
                          <p {...props(styles.quiet)}>None running.</p>
                        )}
                        {archived.length > 0 && (
                          <Shelf
                            label="Archived by coordinator"
                            count={archived.length}
                            leading={<Icon name="archive" size={14} />}
                          >
                            {archived.map((agent) => (
                              <AgentRow
                                key={agent.id}
                                agent={agent}
                                open={openIds.includes(agent.id)}
                                onOpen={() => open(agent.id)}
                              />
                            ))}
                          </Shelf>
                        )}
                      </div>
                    </PanelSection>

                    <PanelSection title="Context" meta="Shared with every agent">
                      {context.map((file) => (
                        <ContextRow key={file.path} file={file} />
                      ))}
                    </PanelSection>

                    <PanelSection title="Subscriptions">
                      {SUBSCRIPTIONS.map((subscription) => {
                        const fired = latest.some(
                          (entry) =>
                            entry.kind === "signal" && entry.source === subscription.source,
                        );

                        return (
                          <div key={subscription.source} {...props(styles.contextRow)}>
                            <span {...props(styles.contextIcon)}>
                              <Icon name={subscription.icon} size={14} />
                            </span>
                            <span {...props(styles.contextText)}>
                              <span {...props(styles.contextPath)}>
                                {subscription.source}
                                {fired && <span {...props(styles.fresh)}>Fired</span>}
                              </span>
                              <span {...props(styles.contextNote)}>{subscription.detail}</span>
                            </span>
                          </div>
                        );
                      })}
                    </PanelSection>
                  </div>
                </div>
              </aside>
            )}
          </main>
        </div>

        <aside
          aria-label="Lab controls"
          {...props(floatingSurfaceStyles.popup, styles.tray, !trayOpen && styles.trayClosed)}
        >
          <div {...props(styles.trayHead)}>
            <span {...props(styles.trayTitle)}>Lab</span>
            <span {...props(styles.trayHint)}>
              {STEPS[step]?.label} · {String(project.agents.size)} agents ·{" "}
              {String(openIds.length + 1)} tabs
            </span>
            <Button
              size="xs"
              iconOnly
              icon={trayOpen ? "chevron-down" : "chevron-up-down"}
              aria-label={trayOpen ? "Collapse lab controls" : "Expand lab controls"}
              onClick={() => setTrayOpen((current) => !current)}
            />
          </div>
          {trayOpen && (
            <>
              <div role="toolbar" aria-label="Timeline" {...props(styles.trayRow)}>
                <Button
                  size="sm"
                  iconOnly
                  icon="arrow-left"
                  aria-label="Previous Step"
                  disabled={step === 0}
                  onClick={() => setStep((current) => Math.max(current - 1, 0))}
                />
                <ToggleGroup
                  aria-label="Step"
                  value={[String(step)]}
                  onValueChange={(values) => {
                    const next = Number(values.at(-1));

                    if (Number.isInteger(next) && next >= 0 && next < STEPS.length) setStep(next);
                  }}
                >
                  {STEPS.map((current, index) => (
                    <Toggle key={current.label} value={String(index)}>
                      {current.label}
                    </Toggle>
                  ))}
                </ToggleGroup>
                <Button
                  size="sm"
                  iconOnly
                  icon="arrow-right"
                  aria-label="Next Step"
                  disabled={step === STEPS.length - 1}
                  onClick={advance}
                />
              </div>
              <div role="toolbar" aria-label="Tabs" {...props(styles.trayRow)}>
                <Choice
                  label="Tabs"
                  value={tabDesign.style}
                  options={[
                    { value: "pill", label: "Pill" },
                    { value: "connected", label: "Connected" },
                  ]}
                  onChange={(style) => setTabDesign({ ...tabDesign, style })}
                />
                <Choice
                  label="Width"
                  value={tabDesign.width}
                  options={[
                    { value: "fit", label: "Fit" },
                    { value: "fixed", label: "Fixed" },
                  ]}
                  onChange={(width) => setTabDesign({ ...tabDesign, width })}
                />
                <Choice
                  label="Past the edge"
                  value={tabDesign.overflow}
                  options={[
                    { value: "scroll", label: "Scroll" },
                    { value: "menu", label: "Menu" },
                  ]}
                  onChange={(overflow) => setTabDesign({ ...tabDesign, overflow })}
                />
                <label {...props(styles.choice)}>
                  <span {...props(styles.choiceLabel)}>Separators</span>
                  <Switch
                    label="Separators"
                    checked={tabDesign.separators}
                    onCheckedChange={(separators) => setTabDesign({ ...tabDesign, separators })}
                  />
                </label>
              </div>
              <div role="toolbar" aria-label="Folders" {...props(styles.trayRow)}>
                <Choice
                  label="Folder"
                  value={folder.style}
                  options={[
                    { value: "paper", label: "Paper" },
                    { value: "flat", label: "Flat" },
                  ]}
                  onChange={(style) => setFolder({ ...folder, style })}
                />
                <Choice
                  label="Face"
                  value={folder.face}
                  options={[
                    { value: "blank", label: "Blank" },
                    { value: "count", label: "Count" },
                    { value: "icon", label: "Icon" },
                  ]}
                  onChange={(face) => setFolder({ ...folder, face })}
                />
                <Choice
                  label="Pages"
                  value={folder.pages}
                  options={[
                    { value: "one", label: "One" },
                    { value: "stack", label: "Stack" },
                  ]}
                  onChange={(pages) => setFolder({ ...folder, pages })}
                />
                <span {...props(styles.fill)} />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={unopened.length === 0}
                  onClick={() => setTabs((current) => unopened.reduce(openTab, current))}
                >
                  Open all {String(project.agents.size)}
                </Button>
                <Button
                  size="sm"
                  disabled={openIds.length === 0}
                  onClick={() => setTabs((current) => openIds.reduce(closeTab, current))}
                >
                  Close all
                </Button>
              </div>
            </>
          )}
        </aside>
      </div>
    </TooltipProvider>
  );
}

const styles = create({
  /** The chrome runs behind everything; the main area is a card set into it. */
  window: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    minHeight: 0,
    backgroundColor: role.sidebarMaterial,
    color: role.contentPrimary,
    fontFamily: type.fontSans,
  },
  lights: { display: "flex", alignItems: "center", gap: 8, paddingInline: "6px 10px" },
  // Stand-ins for the macOS window controls the real titlebar leaves room for.
  light: {
    width: 12,
    height: 12,
    borderRadius: radius.pill,
    backgroundColor: role.bgInteractivePrimaryTranslucent,
  },
  fill: { flex: 1 },
  stage: { display: "flex", flex: 1, minHeight: 0 },
  rail: { width: sidebar.width },
  // The lab's page switcher floats over the bottom corner; the list scrolls clear of it.
  railScroll: { paddingBlockEnd: 56 },
  card: {
    display: "flex",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    marginInlineEnd: shell.cardInset,
    marginBlockEnd: shell.cardInset,
    borderRadius: radius.card,
    backgroundColor: role.bgBase,
    boxShadow: `0 0 0 1px ${role.borderSecondaryTranslucent}`,
    overflow: "hidden",
    transitionProperty: "border-radius",
    transitionDuration: motionTokens.durationNormal,
    transitionTimingFunction: motionTokens.easeOut,
  },
  cardSidebarHidden: { marginInlineStart: shell.cardInset },
  // A 1px corner, not 0, keeps the hairline continuous where the tab meets the card.
  cardSquare: { borderStartStartRadius: 1 },
  pane: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 },
  paneHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: conversation.headerHeight,
    paddingInline: 12,
    flexShrink: 0,
  },
  paneGlyph: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    width: avatar.xs,
    height: avatar.xs,
    color: role.contentSecondary,
  },
  paneTitle: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: type.fontBase,
    fontWeight: 600,
  },
  crumb: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    whiteSpace: "nowrap",
  },
  scroller: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
  },
  scrollerReversed: { flexDirection: "column-reverse" },
  scrollerFaded: {
    maskImage: `linear-gradient(to bottom, transparent, black ${conversation.edgeFade})`,
  },
  transcript: {
    display: "flex",
    flexDirection: "column",
    gap: conversation.turnGap,
    width: `min(${conversation.measure}, 100%)`,
    marginInline: "auto",
    paddingInline: conversation.gutter,
    paddingBlock: conversation.gutter,
  },
  composer: {
    width: `min(${conversation.measure}, 100%)`,
    marginInline: "auto",
    paddingInline: conversation.gutter,
    paddingBottom: conversation.composerInset,
    flexShrink: 0,
  },
  composerFrame: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: 6,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: {
      default: role.borderSecondaryTranslucent,
      ":hover": role.borderPrimaryTranslucent,
      ":focus-within": role.borderPrimaryTranslucent,
    },
    borderRadius: conversation.composerExpandedRadius,
    backgroundColor: role.bgElevated,
    transitionProperty: "border-color",
    transitionDuration: motionTokens.durationFast,
    transitionTimingFunction: motionTokens.easeOut,
  },
  composerInput: { width: "100%" },
  composerRow: { display: "flex", alignItems: "center", gap: 6, paddingInlineStart: 4 },
  composerModel: { color: role.contentTertiary, fontSize: type.fontXs },
  composerGap: { flex: 1 },
  panel: { width: workbench.panelWidth, flexShrink: 0 },
  panelToolbar: { gap: 8, paddingInline: 12 },
  panelTitle: { fontSize: type.fontBase, fontWeight: 600 },
  panelFacts: { color: role.contentTertiary, fontSize: type.fontSm },
  panelScroll: { flex: 1, minHeight: 0, overflowY: "auto" },
  panelHeading: { margin: 0, fontWeight: 500 },
  panelMeta: { color: role.contentTertiary },
  noteGroup: { display: "flex", flexDirection: "column", gap: conversation.turnGap },
  you: {
    alignSelf: "flex-end",
    maxWidth: "80%",
    paddingBlock: 8,
    paddingInline: 12,
    borderRadius: radius.card,
    backgroundColor: role.conversationUserShellBg,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
  coordinator: { display: "flex", alignItems: "flex-start", gap: 10 },
  coordinatorMark: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    paddingBlockStart: 2,
    color: role.contentSecondary,
  },
  coordinatorText: { margin: 0, fontSize: type.fontBase, lineHeight: type.leadingBase },
  delegated: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    padding: 4,
    borderRadius: radius.card,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
  },
  delegatedHead: {
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    paddingBlock: 4,
    paddingInline: 8,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    fontWeight: 500,
  },
  delegatedCount: { color: role.contentTertiary, fontWeight: 400 },
  agentRow: { color: role.contentPrimary },
  receded: { color: role.contentTertiary },
  agentResult: { color: role.contentTertiary, fontSize: type.fontXs },
  projectMeta: { gap: 3 },
  aside: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    color: role.contentTertiary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  asideIcon: { display: "grid", placeItems: "center", flexShrink: 0, paddingBlockStart: 2 },
  asideSource: { color: role.contentSecondary, fontWeight: 500 },
  decision: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 12,
    borderRadius: radius.card,
    backgroundColor: role.bgMuted,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
  },
  decisionPending: {
    backgroundColor: role.bgElevated,
    boxShadow: `inset 0 0 0 1px ${role.borderStrongTranslucent}`,
  },
  decisionHead: { display: "flex", alignItems: "center", gap: 8, color: role.contentPrimary },
  decisionQuestion: { fontWeight: 600 },
  decisionDetail: { margin: 0, color: role.contentSecondary, fontSize: type.fontSm },
  decisionActions: { display: "flex", alignItems: "center", gap: 10 },
  decisionHint: { color: role.contentTertiary, fontSize: type.fontXs },
  quiet: {
    margin: 0,
    paddingInline: workbench.rowPaddingInline,
    color: role.contentTertiary,
    fontSize: type.fontSm,
  },
  contextRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    paddingBlock: 4,
    paddingInline: workbench.rowPaddingInline,
  },
  contextIcon: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    paddingBlockStart: 2,
    color: role.contentSecondary,
  },
  contextText: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  contextPath: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontFamily: type.fontMono,
    fontSize: type.fontSm,
  },
  contextNote: { color: role.contentTertiary, fontSize: type.fontSm },
  fresh: {
    paddingInline: 6,
    borderRadius: radius.pill,
    backgroundColor: role.bgInteractivePrimaryTranslucent,
    color: role.contentInteractivePrimary,
    fontFamily: type.fontSans,
    fontSize: type.fontXs,
  },
  /** The lab's own controls float over the bottom corner, clear of the page switcher. */
  tray: {
    position: "fixed",
    insetBlockEnd: 12,
    insetInlineEnd: 12,
    zIndex: layer.toast,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    maxWidth: "min(760px, calc(100vw - 24px))",
    padding: 10,
    color: role.contentPrimary,
  },
  trayClosed: { gap: 0 },
  trayHead: { display: "flex", alignItems: "center", gap: 8 },
  trayTitle: { fontSize: type.fontSm, fontWeight: 600 },
  trayHint: { flex: 1, color: role.contentTertiary, fontSize: type.fontXs },
  trayRow: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 },
  choice: { display: "inline-flex", alignItems: "center", gap: 6 },
  choiceLabel: { color: role.contentTertiary, fontSize: type.fontXs },
});
