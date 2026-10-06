/**
 * Projects: you talk to one coordinator, and it runs the agents.
 *
 * The rail lists projects instead of threads. The coordinator delegates each
 * piece to an agent, answers what shared context can answer, archives agents
 * as their work lands, and stops for you only when a call is yours to make.
 * Agents stay reachable in the project's panel, but nothing asks you to tidy
 * them. Reference: https://cursor.com/blog/projects
 *
 * The coordinator is scripted; step through it with the scrubber. Typing in
 * the composer saves a preference to shared context, as a real one would.
 */
import { create, props } from "@stylexjs/stylex";
import { useState, type ReactElement, type ReactNode } from "react";
import type { SessionMark } from "@nyte-ai/client";
import { sidebarStyles as rail } from "@nyte-ai/app/chrome/sidebar.stylex.ts";
import { StatusDot } from "@nyte-ai/app/components/ui.tsx";
import { Button } from "@nyte-ai/ui/button";
import { Icon, type IconName } from "@nyte-ai/ui/icon";
import { Input } from "@nyte-ai/ui/input";
import { Row } from "@nyte-ai/ui/row";
import { radius } from "@nyte-ai/ui/schema.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { RailFrame, Shelf } from "../sidebar/rail";
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
    <span title="This Mac" {...props(rail.sessionBadgeHost)}>
      {glyph}
      <span {...props(rail.sessionBadge)}>
        <Icon name="laptop" size={9} label="This Mac" />
      </span>
    </span>
  );
}

function AgentRow({ agent }: { readonly agent: Agent }): ReactElement {
  return (
    <Row xstyle={[rail.rowSurface, styles.agentRow, agent.state === "archived" && styles.receded]}>
      <Row.Leading xstyle={rail.rowIcon}>
        <AgentGlyph agent={agent} />
      </Row.Leading>
      <Row.Label>{agent.task}</Row.Label>
      {agent.result !== undefined && (
        <Row.Meta xstyle={styles.agentResult}>{agent.result}</Row.Meta>
      )}
    </Row>
  );
}

function ProjectRow({
  name,
  mark,
  working,
  ask,
  selected,
}: {
  readonly name: string;
  readonly mark: SessionMark;
  readonly working: number;
  readonly ask: string | undefined;
  readonly selected: boolean;
}): ReactElement {
  const titleLine = (
    <>
      <Row.Label xstyle={rail.sessionLabel}>{name}</Row.Label>
      {working > 0 && (
        <Row.Meta
          xstyle={[rail.rowMeta, styles.projectMeta]}
          title={`${String(working)} agents working`}
        >
          <Icon name="agent" size={12} />
          {working}
        </Row.Meta>
      )}
    </>
  );

  return (
    <Row
      selected={selected}
      xstyle={[
        rail.rowSurface,
        rail.sessionRow,
        selected && rail.rowSelected,
        ask !== undefined && rail.sessionRowAsk,
      ]}
    >
      {selected && <Row.Backdrop xstyle={rail.sessionSelection} />}
      <Row.Primary aria-current={selected ? "page" : undefined}>
        <Row.Leading xstyle={[rail.rowIcon, ask !== undefined && rail.rowIconAsk]}>
          {mark === "idle" ? <Icon name="layers" size={14} /> : <StatusDot mark={mark} />}
        </Row.Leading>
        {ask === undefined ? (
          titleLine
        ) : (
          <Row.Body>
            <span {...props(rail.sessionTitleLine)}>{titleLine}</span>
            <Row.Description xstyle={[intent.warning, rail.sessionAsk]}>{ask}</Row.Description>
          </Row.Body>
        )}
      </Row.Primary>
    </Row>
  );
}

function ProjectsRail({
  mark,
  working,
  ask,
}: {
  readonly mark: SessionMark;
  readonly working: number;
  readonly ask: string | undefined;
}): ReactElement {
  return (
    <RailFrame label="Projects sidebar">
      <div {...props(rail.primaryActions)}>
        <Row variant="nav" xstyle={rail.navRow}>
          <Row.Leading xstyle={rail.navLeading}>
            <Icon name="plus" size={14} />
          </Row.Leading>
          <Row.Label>New Project</Row.Label>
        </Row>
        <Row variant="nav" xstyle={rail.navRow}>
          <Row.Leading xstyle={rail.navLeading}>
            <Icon name="search" size={14} />
          </Row.Leading>
          <Row.Label>Search</Row.Label>
        </Row>
      </div>
      <div {...props(rail.scroll)}>
        <section aria-label="Projects" {...props(rail.section)}>
          <div {...props(rail.sectionHeader)}>
            <span {...props(rail.sectionToggle)}>
              <span {...props(rail.sectionLabel)}>Projects</span>
            </span>
          </div>
          <ProjectRow name={PROJECT} mark={mark} working={working} ask={ask} selected />
          {OTHER_PROJECTS.map((project) => (
            <ProjectRow
              key={project.id}
              name={project.name}
              mark={project.working > 0 ? "working" : "idle"}
              working={project.working}
              ask={undefined}
              selected={false}
            />
          ))}
        </section>
        <Shelf
          label="Chats"
          count={LOOSE_CHATS.length}
          leading={<Icon name="new-chat" size={14} />}
        >
          {LOOSE_CHATS.map((title) => (
            <Row key={title} xstyle={[rail.rowSurface, rail.sessionRow]}>
              <Row.Primary>
                <Row.Leading xstyle={rail.rowIcon} />
                <Row.Label>{title}</Row.Label>
              </Row.Primary>
            </Row>
          ))}
        </Shelf>
      </div>
    </RailFrame>
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
  pending,
  onAct,
}: {
  readonly entry: Entry;
  readonly agents: ReadonlyMap<string, Agent>;
  readonly pending: Decision | undefined;
  readonly onAct: () => void;
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
            <AgentRow key={agent.id} agent={agent} />
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
    <section aria-label={title} {...props(styles.panelSection)}>
      <h3 {...props(styles.panelHeading)}>
        <span>{title}</span>
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

export function ProjectsPage(): ReactElement {
  const [step, setStep] = useState(NEEDS_YOU_STEP);
  const [notes, setNotes] = useState<readonly string[]>([]);
  const [draft, setDraft] = useState("");
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

  const advance = (): void => setStep((current) => Math.min(current + 1, STEPS.length - 1));

  const send = (): void => {
    const text = draft.trim();

    if (text === "") return;
    setNotes((current) => [...current, text]);
    setDraft("");
  };

  return (
    <main {...props(styles.page)}>
      <div {...props(styles.column)}>
        <header {...props(styles.header)}>
          <h1 {...props(styles.title)}>Projects</h1>
          <p {...props(styles.lede)}>
            You direct one coordinator. It runs the agents, answers what context can, and puts
            finished work away. {String(project.agents.size)} agents have run on this project; none
            of them is in your sidebar.
          </p>
        </header>

        <div role="toolbar" aria-label="Timeline" {...props(styles.toolbar)}>
          <Button
            size="sm"
            variant="outline"
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
            variant="outline"
            iconOnly
            icon="arrow-right"
            aria-label="Next Step"
            disabled={step === STEPS.length - 1}
            onClick={advance}
          />
        </div>

        <div {...props(styles.window)}>
          <ProjectsRail mark={mark} working={working.length} ask={project.pending?.question} />

          <section aria-label="Coordinator" {...props(styles.conversation)}>
            <header {...props(styles.conversationHeader)}>
              <div {...props(styles.conversationTitle)}>
                <span {...props(styles.projectName)}>{PROJECT}</span>
                <span {...props(styles.projectFacts)}>
                  Coordinator · {String(working.length)} working · {String(archived.length)}{" "}
                  archived
                </span>
              </div>
              <span {...props(styles.place)} title="Keeps running when this Mac sleeps">
                <Icon name="cloud" size={14} />
                Cloud
              </span>
            </header>
            {/* Reversed so the newest entry holds the bottom as steps add more. */}
            <div {...props(styles.transcriptScroll)}>
              <div {...props(styles.transcript)}>
                {project.entries.map((entry, index) => (
                  <EntryView
                    key={index}
                    entry={entry}
                    agents={project.agents}
                    pending={project.pending}
                    onAct={advance}
                  />
                ))}
                {notes.map((note, index) => (
                  <div key={`note-${String(index)}`} {...props(styles.noteGroup)}>
                    <div {...props(styles.you)}>{note}</div>
                    <Aside icon="file-text">
                      Saved to <code>preferences.md</code>. Every agent follows it from now on.
                    </Aside>
                  </div>
                ))}
              </div>
            </div>
            <form
              {...props(styles.composer)}
              onSubmit={(event) => {
                event.preventDefault();
                send();
              }}
            >
              <Input
                aria-label="Direct the project"
                placeholder="Direct the project"
                value={draft}
                onValueChange={setDraft}
                xstyle={styles.composerInput}
              />
              <Button size="md" variant="solid" type="submit" disabled={draft.trim() === ""}>
                Send
              </Button>
            </form>
          </section>

          <aside aria-label="Project" {...props(styles.panel)}>
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
              <div {...props(rail.section)}>
                {[...working, ...done].map((agent) => (
                  <AgentRow key={agent.id} agent={agent} />
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
                      <AgentRow key={agent.id} agent={agent} />
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
                  (entry) => entry.kind === "signal" && entry.source === subscription.source,
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
          </aside>
        </div>

        <section {...props(styles.notes)}>
          <h2 {...props(styles.notesTitle)}>How it maps to Nyte</h2>
          <ul {...props(styles.list)}>
            <li>
              A project is one session whose agent only delegates. Its agents are child sessions,
              which <code>sessionsForNavigation</code> already keeps out of the rail.
            </li>
            <li>
              The coordinator archives finished children with the same call as the rail&apos;s
              archive button, so the Inbox shelves and this panel agree.
            </li>
            <li>
              Shared context is a folder every child reads at start, such as{" "}
              <code>.nyte/projects/dialog-surface/</code>.
            </li>
            <li>
              Cloud keeps the coordinator running on the connected server; a check that needs this
              Mac starts a local child.
            </li>
            <li>
              Subscriptions are the one part the desktop can&apos;t own: the host has to wake the
              coordinator on a schedule or a PR event.
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}

const styles = create({
  page: {
    height: "100%",
    overflowY: "auto",
    backgroundColor: role.bgBase,
    color: role.contentPrimary,
    fontFamily: type.fontSans,
  },
  column: {
    display: "flex",
    flexDirection: "column",
    gap: 24,
    maxWidth: 1440,
    marginInline: "auto",
    padding: "48px 32px 96px",
  },
  header: { display: "flex", flexDirection: "column", gap: 4, maxWidth: 760 },
  title: { margin: 0, fontSize: type.font2xl, fontWeight: 600, letterSpacing: type.letterLg },
  lede: { margin: 0, color: role.contentSecondary, fontSize: type.fontBase },
  toolbar: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 },
  window: {
    display: "grid",
    gridTemplateColumns: "max-content minmax(0, 1fr) 320px",
    height: 760,
    borderRadius: radius.card,
    overflow: "hidden",
    backgroundColor: role.sidebarMaterial,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
  },
  conversation: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
    backgroundColor: role.bgBase,
    borderInlineWidth: 1,
    borderInlineStyle: "solid",
    borderInlineColor: role.borderSecondaryTranslucent,
  },
  conversationHeader: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    paddingBlock: 12,
    paddingInline: 20,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondaryTranslucent,
  },
  conversationTitle: { display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 },
  projectName: { fontSize: type.fontLg, fontWeight: 600 },
  projectFacts: { color: role.contentTertiary, fontSize: type.fontSm },
  place: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    paddingBlock: 2,
    paddingInline: 8,
    borderRadius: radius.pill,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
    color: role.contentSecondary,
    fontSize: type.fontXs,
  },
  transcriptScroll: {
    display: "flex",
    flexDirection: "column-reverse",
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
  },
  transcript: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    width: "100%",
    maxWidth: 680,
    marginInline: "auto",
    padding: 24,
  },
  noteGroup: { display: "flex", flexDirection: "column", gap: 16 },
  you: {
    alignSelf: "flex-end",
    maxWidth: "80%",
    paddingBlock: 8,
    paddingInline: 12,
    borderRadius: radius.card,
    backgroundColor: role.bgMuted,
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
  projectMeta: { gap: 2 },
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
  composer: {
    display: "flex",
    gap: 8,
    paddingBlock: 12,
    paddingInline: 20,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: role.borderSecondaryTranslucent,
  },
  composerInput: { flex: 1 },
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: 24,
    minHeight: 0,
    overflowY: "auto",
    padding: 16,
  },
  panelSection: { display: "flex", flexDirection: "column", gap: 8 },
  panelHeading: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
    margin: 0,
    color: role.contentTertiary,
    fontSize: type.fontXs,
    fontWeight: 500,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  panelMeta: { textTransform: "none", letterSpacing: 0, fontWeight: 400 },
  quiet: { margin: 0, color: role.contentTertiary, fontSize: type.fontSm },
  contextRow: { display: "flex", alignItems: "flex-start", gap: 8, paddingBlock: 4 },
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
  notes: { display: "flex", flexDirection: "column", gap: 8, maxWidth: 760 },
  notesTitle: { margin: 0, fontSize: type.fontBase, fontWeight: 600 },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    margin: 0,
    paddingInlineStart: 20,
    color: role.contentSecondary,
    fontSize: type.fontSm,
  },
});
