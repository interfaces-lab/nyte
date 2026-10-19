import { props } from "@stylexjs/stylex";
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { sidebarStyles } from "@nyte-ai/app/chrome/sidebar.stylex.ts";
import { titlebarStyles } from "@nyte-ai/app/chrome/titlebar.stylex.ts";
import { workbenchStyles } from "@nyte-ai/app/workbench/workbench.stylex.ts";
import { Button } from "@nyte-ai/ui/button";
import { floatingSurfaceStyles } from "@nyte-ai/ui/styles/floating-surface.stylex";
import { Icon, PanelToggleIcon, type IconName } from "@nyte-ai/ui/icon";
import { Kbd } from "@nyte-ai/ui/kbd";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@nyte-ai/ui/menu";
import { Switch } from "@nyte-ai/ui/switch";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { Shelf } from "../sidebar/rail";
import type { FolderDesign } from "./folder";
import { TabStrip, type TabDesign, type TabItem } from "./tabs";
import {
  LOOSE_CHATS,
  OTHER_PROJECTS,
  PROJECT,
  PROJECT_APPEARANCE,
  PROJECT_ID,
  projectAt,
  STEPS,
  type Appearance,
  type ProjectListing,
} from "./timeline";
import { ProjectGlyph, projectMark } from "./appearance";
import { ProjectSwitcher, type SwitcherPlacement } from "./switcher";
import { styles } from "./page.stylex";
import {
  AgentPane,
  Aside,
  Composer,
  ContextRow,
  DecisionCard,
  EntryView,
  FadedScroll,
  PaneHeader,
  PanelSection,
} from "./panes";
import { AgentGlyph, AgentRow, Rail, agentsIn, stateLabel, type ProjectMarkStyle } from "./rail";
import {
  COORDINATOR,
  INITIAL_TABS,
  activate,
  closeTab,
  cycleTab,
  openTab,
  reopenTab,
} from "./tab-state";

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

const FOLDER_DEFAULT: FolderDesign = { style: "paper", face: "count", pages: "stack" };

const TABS_DEFAULT: TabDesign = {
  style: "connected",
  width: "fit",
  overflow: "scroll",
  separators: true,
};

interface SwitcherDesign {
  readonly placement: SwitcherPlacement;
  readonly mark: ProjectMarkStyle;
}

const SWITCHER_DEFAULT: SwitcherDesign = { placement: "rail", mark: "appearance" };

/** New projects take the next look in turn, so two in a row never match. */
const NEW_LOOKS: readonly Appearance[] = [
  { icon: "cube", tint: "teal" },
  { icon: "globe", tint: "pink" },
  { icon: "book", tint: "yellow" },
  { icon: "bug", tint: "red" },
];

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
  const [projectId, setProjectId] = useState(PROJECT_ID);
  const [created, setCreated] = useState<readonly ProjectListing[]>([]);
  const [switcher, setSwitcher] = useState(SWITCHER_DEFAULT);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const project = projectAt(step);
  const working = agentsIn(project.agents, "working");
  const done = agentsIn(project.agents, "done");
  const archived = agentsIn(project.agents, "archived");
  const latest = STEPS[step]?.entries ?? [];

  const context = project.context.map((file) =>
    file.path === "preferences.md" && notes.length > 0
      ? { ...file, note: notes.at(-1) ?? file.note, fresh: true }
      : file,
  );

  const openIds = tabs.open.filter((id) => project.agents.has(id));

  const activeId =
    tabs.active === COORDINATOR || openIds.includes(tabs.active) ? tabs.active : COORDINATOR;

  const projects: readonly ProjectListing[] = [
    {
      id: PROJECT_ID,
      name: PROJECT,
      appearance: PROJECT_APPEARANCE,
      working: working.length,
      ask: project.pending?.question,
      updated: "now",
      brief: "",
    },
    ...OTHER_PROJECTS,
    ...created,
  ];

  const home = projectId === PROJECT_ID;
  const selected = projects.find((entry) => entry.id === projectId) ?? projects[0];
  const activeAgent = home ? project.agents.get(activeId) : undefined;
  const unopened = [...project.agents.keys()].filter((id) => !openIds.includes(id));
  const orderKey = [COORDINATOR, ...openIds].join(" ");

  const advance = (): void => setStep((current) => Math.min(current + 1, STEPS.length - 1));
  const open = (id: string): void => setTabs((current) => openTab(current, id));
  const close = (id: string): void => setTabs((current) => closeTab(current, id));
  const onCornerChange = useCallback((square: boolean) => setSquareCorner(square), []);

  const createProject = (name: string): void => {
    const look = NEW_LOOKS[created.length % NEW_LOOKS.length] ?? PROJECT_APPEARANCE;
    const id = `new-${String(created.length)}`;

    setCreated((current) => [
      ...current,
      {
        id,
        name: name === "" ? "Untitled project" : name,
        appearance: look,
        working: 0,
        ask: undefined,
        updated: "now",
        brief: "Tell me what this project is for, and I'll plan the first agents.",
      },
    ]);
    setProjectId(id);
  };

  const selection = {
    board: "projects",
    step: STEPS[step]?.label,
    project: projectId,
    switcher,
    tabs: tabDesign,
    folder,
    sidebar: sidebarOpen,
    panel: panelOpen,
    openTabs: home ? [COORDINATOR, ...openIds] : [COORDINATOR],
    activeTab: activeId,
  };

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);

    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const meta = event.metaKey || event.ctrlKey;
      const digit = /^Digit([1-9])$/.exec(event.code)?.[1];

      if (event.altKey && !event.shiftKey && event.code === "KeyP") {
        event.preventDefault();
        setSwitcherOpen((open) => !open);
      } else if (event.altKey && event.key.toLowerCase() === "w") {
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

  const projectGlyph = (surface: "card" | "sidebar"): ReactElement | undefined =>
    selected === undefined ? undefined : (
      <ProjectGlyph
        appearance={selected.appearance}
        mark={projectMark(selected)}
        surface={surface}
      />
    );

  const tabItems: readonly TabItem[] = [
    {
      id: COORDINATOR,
      title: selected?.name ?? PROJECT,
      glyph: projectGlyph("card"),
      closable: false,
      preview: "Coordinator",
    },
    ...(home ? openIds : []).flatMap((id) => {
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

  const switcherElement = (
    <ProjectSwitcher
      open={switcherOpen}
      placement={switcher.placement}
      projects={projects}
      currentId={projectId}
      chats={LOOSE_CHATS}
      onOpenChange={setSwitcherOpen}
      onSelect={setProjectId}
      onNewProject={createProject}
    />
  );

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
            {switcher.placement === "titlebar" ? (
              <span {...props(styles.titlebarSwitcher)}>{switcherElement}</span>
            ) : (
              <span {...props(styles.fill)} />
            )}
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
                    openIds
                      .slice(openIds.findIndex((entry) => entry === id) + 1)
                      .reduce(closeTab, current),
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
              projects={projects}
              selectedId={projectId}
              markStyle={switcher.mark}
              folder={folder}
              switcher={switcher.placement === "rail" ? switcherElement : undefined}
              onSelect={setProjectId}
              onNewProject={() => createProject("")}
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
              ) : !home ? (
                <>
                  <PaneHeader title={selected?.name ?? PROJECT} place="cloud">
                    {projectGlyph("card")}
                  </PaneHeader>
                  <FadedScroll reversed>
                    <div {...props(styles.transcript)}>
                      <EntryView
                        entry={{ kind: "coordinator", text: selected?.brief ?? "" }}
                        agents={new Map()}
                        openIds={[]}
                        pending={undefined}
                        onAct={advance}
                        onOpenAgent={open}
                      />
                    </div>
                  </FadedScroll>
                  <Composer value={draft} onChange={setDraft} onSend={send} />
                </>
              ) : (
                <>
                  <PaneHeader title={PROJECT} place="cloud">
                    {projectGlyph("card")}
                  </PaneHeader>
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

            {panelOpen && !home && selected !== undefined && (
              <aside
                aria-label="Project"
                {...props(workbenchStyles.panel, workbenchStyles.panelOpen, styles.panel)}
              >
                <div {...props(workbenchStyles.toolbar, styles.panelToolbar)}>
                  <span {...props(styles.panelTitle)}>Project</span>
                  <span {...props(styles.panelFacts)}>
                    {String(selected.working)} working · updated {selected.updated}
                  </span>
                </div>
                <div {...props(styles.panelScroll)}>
                  <div {...props(workbenchStyles.rail)}>
                    <PanelSection title="Needs you">
                      <p {...props(styles.quiet)}>{selected.ask ?? "Nothing right now."}</p>
                    </PanelSection>
                    <PanelSection title="Agents" meta={`${String(selected.working)} working`}>
                      <p {...props(styles.quiet)}>
                        {selected.working === 0
                          ? "None running."
                          : `Only ${PROJECT} plays a timeline on this board.`}
                      </p>
                    </PanelSection>
                  </div>
                </div>
              </aside>
            )}

            {panelOpen && home && (
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
              variant="ghost"
              icon={copied ? "checkmark" : "copy"}
              onClick={() =>
                void navigator.clipboard
                  .writeText(JSON.stringify(selection, null, 2))
                  .then(() => setCopied(true))
              }
            >
              {copied ? "Copied" : "Copy JSON"}
            </Button>
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
              <div role="toolbar" aria-label="Switcher" {...props(styles.trayRow)}>
                <Choice
                  label="Switcher"
                  value={switcher.placement}
                  options={[
                    { value: "rail", label: "Top of sidebar" },
                    { value: "titlebar", label: "Titlebar" },
                  ]}
                  onChange={(placement) => setSwitcher({ ...switcher, placement })}
                />
                <Choice
                  label="Mark"
                  value={switcher.mark}
                  options={[
                    { value: "appearance", label: "Appearance" },
                    { value: "folder", label: "Folder" },
                  ]}
                  onChange={(mark) => setSwitcher({ ...switcher, mark })}
                />
                <span {...props(styles.trayHint)}>
                  <Kbd keys={["⌥", "P"]} plain /> switches
                </span>
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
