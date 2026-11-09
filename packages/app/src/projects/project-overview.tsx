import { create, props } from "@stylexjs/stylex";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { openQuestions } from "@nyte-ai/plugin/question/schema";
import type { OpenQuestion } from "@nyte-ai/plugin/question/schema";
import { showsText } from "@nyte-ai/plugin/client/presentation";
import type { TaskState } from "@nyte-ai/plugin/client/presentation";
import type { ProjectId, ProjectInfo, SessionId } from "@nyte-ai/sdk";
import { Button } from "@nyte-ai/ui/button";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { Input } from "@nyte-ai/ui/input";
import { Loader } from "@nyte-ai/ui/loader";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { toast } from "@nyte-ai/ui/toast";
import { useChatTasks, useChats } from "../chats/index.ts";
import { composerMessageContent, sendComposerMessage } from "../chat/composer/composer-send.ts";
import type { ChatDirectory, ChildTask } from "../chats/index.ts";
import { Prose } from "../chat/markdown/prose.tsx";
import { answerQuestion } from "../chat/trays/questions-state.ts";
import { ChangeStats } from "../components/change-stats.tsx";
import { TaskMark } from "../components/task-mark.tsx";
import { errorMessage } from "../contract/errors.ts";
import { chatStore } from "../data/chat-store.ts";
import type { ChatView } from "../data/chat-store.ts";
import { connected } from "../data/connection.ts";
import { useWorkspaceCatalog } from "../data/plugins.ts";
import { useProject } from "../data/projects.ts";
import { useWatchSelect } from "../data/watch-store.ts";
import { useWorkspaces } from "../data/workspaces.ts";
import { settingsStyles as page } from "../settings/settings.stylex.ts";
import { windowTabs } from "../tabs/window-tabs.ts";
import { settings } from "../theme/schema.stylex.ts";
import { settingsPatterns as patterns } from "../theme/settings-patterns.stylex.ts";
import { openProjectDialog } from "./project-dialog.tsx";
import { startProjectChat } from "./start-project-chat.ts";

export function ProjectOverview({ id }: { readonly id: ProjectId }): ReactElement {
  const result = useProject(id);

  if (result.kind === "loading")
    return (
      <div {...props(page.content, styles.placeholder)}>
        <Loader />
      </div>
    );

  if (result.kind === "missing")
    return (
      <div {...props(page.content, styles.placeholder)}>
        <p {...props(text.base, styles.quiet)}>Project not found.</p>
      </div>
    );

  return <ProjectPage project={result.project} />;
}

function ProjectPage({ project }: { readonly project: ProjectInfo }): ReactElement {
  const folder = useWorkspaces().data?.find((workspace) => workspace.id === project.workspace);

  const agents = useChatTasks(project.coordinator ?? undefined).filter(
    (task): task is ChildTask => task.kind === "child",
  );

  const meta = [
    ...(folder === undefined ? [] : [folder.name]),
    ...(agents.length === 0
      ? []
      : [`${String(agents.length)} ${agents.length === 1 ? "agent" : "agents"}`]),
  ];

  return (
    <div {...props(page.content)}>
      <div {...props(page.contentInner, styles.wide)}>
        <header {...props(styles.header)}>
          <div {...props(page.titleRow)}>
            <h1 {...props(patterns.pageTitle)}>{project.name}</h1>
            <Button
              iconOnly
              icon="settings"
              aria-label={`${project.name} Settings`}
              onClick={() => openProjectDialog(project.id)}
            />
          </div>
          {meta.length > 0 && <p {...props(text.base, styles.quiet)}>{meta.join(" · ")}</p>}
        </header>
        <div {...props(styles.columns)}>
          <div {...props(styles.column)}>
            {project.coordinator === null ? (
              <div {...props(patterns.group)}>
                <Entry title="No coordinator chat yet">
                  <Button
                    variant="solid"
                    tone="primary"
                    onClick={() =>
                      startProjectChat(project, "").catch((cause: unknown) =>
                        toast.add({ type: "error", title: errorMessage(cause) }),
                      )
                    }
                  >
                    Start Chat
                  </Button>
                </Entry>
              </div>
            ) : (
              <Agents coordinator={project.coordinator} agents={agents} />
            )}
          </div>
          <aside aria-label="Project setup" {...props(styles.column)}>
            <Setup project={project} />
          </aside>
        </div>
      </div>
    </div>
  );
}

type Group = "needs" | "finished" | "working" | "done";

const SECTIONS = [
  { group: "needs", title: "Needs you" },
  { group: "finished", title: "Finished" },
  { group: "working", title: "Working" },
] as const satisfies readonly { readonly group: Group; readonly title: string }[];

function Agents({
  coordinator,
  agents,
}: {
  readonly coordinator: SessionId;
  readonly agents: readonly ChildTask[];
}): ReactElement {
  const chats = useChats((directory) => directory);
  const grouped = Object.groupBy(agents, (agent) => groupFor(agent, chats));
  const done = grouped.done ?? [];

  return (
    <>
      <div {...props(patterns.group)}>
        <AgentEntry
          id={coordinator}
          title="Coordinator"
          state={chats.get(coordinator)?.mark ?? "done"}
          group="coordinator"
        />
        <CoordinatorReply id={coordinator} />
      </div>
      {agents.length === 0 && <p {...props(text.base, styles.quiet)}>No agents yet.</p>}
      {SECTIONS.map((section) => {
        const members = grouped[section.group] ?? [];

        if (members.length === 0) return null;

        return (
          <Section key={section.group} title={section.title}>
            {members.map((agent) => (
              <AgentEntry
                key={agent.id}
                id={agent.id}
                title={agent.title}
                state={agent.state}
                group={section.group}
              />
            ))}
          </Section>
        );
      })}
      {done.length > 0 && (
        <Collapsible.Root {...props(patterns.section)}>
          <Collapsible.Trigger xstyle={styles.doneToggle}>
            <span {...props(text.base)}>{`${String(done.length)} done`}</span>
            <Collapsible.Chevron />
          </Collapsible.Trigger>
          <Collapsible.Panel>
            <div {...props(patterns.group)}>
              {done.map((agent) => (
                <AgentEntry
                  key={agent.id}
                  id={agent.id}
                  title={agent.title}
                  state={agent.state}
                  group="done"
                />
              ))}
            </div>
          </Collapsible.Panel>
        </Collapsible.Root>
      )}
    </>
  );
}

function groupFor(agent: ChildTask, chats: ChatDirectory): Group {
  switch (agent.state) {
    case "waiting":
    case "failed":
      return "needs";
    case "working":
    case "retrying":
    case "background":
      return "working";
    case "done":
      return (chats.get(agent.id)?.unreadTip ?? null) === null ? "done" : "finished";
    default: {
      const _exhaustive: never = agent.state;

      return _exhaustive;
    }
  }
}

function AgentEntry({
  id,
  title,
  state,
  group,
}: {
  readonly id: SessionId;
  readonly title: string;
  readonly state: TaskState;
  readonly group: Group | "coordinator";
}): ReactElement {
  return (
    <Entry
      title={
        <span {...props(styles.entryTitle)}>
          <TaskMark state={state} unread={group === "finished"} />
          {title}
        </span>
      }
      detail={<Detail id={id} state={state} group={group} />}
    >
      <Button size="sm" variant="outline" onClick={() => windowTabs.openChat(id, "permanent")}>
        Open Chat
      </Button>
    </Entry>
  );
}

function Detail({
  id,
  state,
  group,
}: {
  readonly id: SessionId;
  readonly state: TaskState;
  readonly group: Group | "coordinator";
}): ReactNode {
  switch (group) {
    case "needs":
      return state === "waiting" ? <Question id={id} /> : <Reply id={id} />;
    case "coordinator":
    case "finished":
      return <Reply id={id} />;
    case "working":
    case "done":
      return null;
    default: {
      const _exhaustive: never = group;

      return _exhaustive;
    }
  }
}

function Question({ id }: { readonly id: SessionId }): ReactNode {
  const request = useWatchSelect(
    chatStore(id),
    (state) => openQuestions(state.value)[0],
    (left, right) => JSON.stringify(left) === JSON.stringify(right),
  );

  const answer = useMutation({
    mutationFn: (input: { readonly request: OpenQuestion; readonly label: string }) =>
      answerQuestion(id, input.request, [[input.label]]),
    onError: (cause) => toast.add({ type: "error", title: errorMessage(cause) }),
  });

  const first = request?.questions[0];

  if (request === undefined || first === undefined) return null;

  const choosable = request.questions.length === 1 && first.multiple !== true;

  return (
    <div {...props(styles.reply)}>
      <p {...props(text.base, styles.detailText)}>{first.question}</p>
      {choosable && first.options.length > 0 && (
        <div {...props(styles.choices)}>
          {first.options.map((option) => (
            <Button
              key={option.label}
              size="sm"
              variant="outline"
              title={option.description === "" ? undefined : option.description}
              disabled={answer.isPending}
              loading={answer.isPending && answer.variables.label === option.label}
              onClick={() => answer.mutate({ request, label: option.label })}
            >
              {option.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function CoordinatorReply({ id }: { readonly id: SessionId }): ReactElement {
  const [draft, setDraft] = useState("");

  const send = useMutation({
    mutationFn: async (message: string) => {
      const connection = await connected();

      return sendComposerMessage(connection.session(id), {
        kind: "message",
        content: composerMessageContent([{ kind: "text", text: message }], []),
        delivery: "queue",
      });
    },
    onSuccess: () => setDraft(""),
    onError: (cause) => toast.add({ type: "error", title: errorMessage(cause) }),
  });

  const message = draft.trim();

  return (
    <form
      {...props(styles.replyForm)}
      onSubmit={(event) => {
        event.preventDefault();

        if (message !== "" && !send.isPending) send.mutate(message);
      }}
    >
      <Input
        aria-label="Reply to the coordinator"
        placeholder="Reply to the coordinator"
        value={draft}
        disabled={send.isPending}
        onValueChange={setDraft}
        xstyle={styles.replyField}
      />
      <Button type="submit" variant="outline" disabled={message === ""} loading={send.isPending}>
        Send
      </Button>
    </form>
  );
}

function Reply({ id }: { readonly id: SessionId }): ReactNode {
  const reply = useWatchSelect(
    chatStore(id),
    (state) => (state.value === undefined ? undefined : readReply(state.value)),
    (left, right) => JSON.stringify(left) === JSON.stringify(right),
  );

  if (reply === undefined || (reply.lead === "" && reply.files === 0)) return null;

  return (
    <div {...props(styles.reply)}>
      {reply.lead !== "" && <Prose markdown={reply.lead} />}
      {reply.files > 0 && (
        <span {...props(text.sm, styles.changes)}>
          {`${String(reply.files)} ${reply.files === 1 ? "file" : "files"}`}
          <ChangeStats added={reply.added} removed={reply.removed} />
        </span>
      )}
    </div>
  );
}

function readReply(view: ChatView) {
  const markdown = view.messages.findLast(showsText)?.state.markdown ?? "";

  return {
    lead: markdown.trim().split(/\n\s*\n/u)[0] ?? "",
    files: view.changes.length,
    added: view.changes.reduce((sum, change) => sum + change.added, 0),
    removed: view.changes.reduce((sum, change) => sum + change.removed, 0),
  };
}

function Setup({ project }: { readonly project: ProjectInfo }): ReactNode {
  const docs = useWorkspaceCatalog(project.workspace).data?.docs ?? [];

  if (project.instructions.trim() === "" && project.skills.length === 0 && docs.length === 0)
    return (
      <Section title="Setup">
        <Entry title="No instructions or skills yet">
          <Button size="sm" variant="outline" onClick={() => openProjectDialog(project.id)}>
            Edit Setup
          </Button>
        </Entry>
      </Section>
    );

  return (
    <Section title="Setup">
      {project.instructions.trim() !== "" && (
        <Entry
          title="Instructions"
          detail={
            <p {...props(text.base, styles.detailText, styles.instructions)}>
              {project.instructions}
            </p>
          }
        />
      )}
      {project.skills.length > 0 && (
        <Entry
          title="Skills"
          detail={<p {...props(text.base, styles.detailText)}>{project.skills.join(", ")}</p>}
        />
      )}
      {docs.length > 0 && (
        <Entry
          title="Shared context"
          detail={
            <ul {...props(styles.docs)}>
              {docs.map((doc) => (
                <li key={doc.id} {...props(text.base, styles.detailText)}>
                  {project.disabledDocs.includes(doc.id) ? `${doc.name} (off)` : doc.name}
                </li>
              ))}
            </ul>
          }
        />
      )}
    </Section>
  );
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section aria-label={title} {...props(patterns.section)}>
      <div {...props(patterns.sectionHeader)}>
        <h2 {...props(patterns.sectionTitle)}>{title}</h2>
      </div>
      <div {...props(patterns.group)}>{children}</div>
    </section>
  );
}

function Entry({
  title,
  detail,
  children,
}: {
  readonly title: ReactNode;
  readonly detail?: ReactNode;
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <div {...props(patterns.row, patterns.rowDetailed, patterns.rowRule)}>
      <div {...props(patterns.rowCopy)}>
        <span {...props(patterns.rowTitle)}>{title}</span>
        {detail}
      </div>
      {children !== undefined && <div {...props(patterns.rowControl)}>{children}</div>}
    </div>
  );
}

const WIDE = "@container (min-width: 880px)";

const styles = create({
  placeholder: { display: "grid", placeItems: "center" },
  header: { display: "flex", flexDirection: "column", gap: space.s1 },
  wide: { width: `min(1040px, calc(100% - 2 * ${settings.contentGutter}))` },
  columns: {
    display: "grid",
    gridTemplateColumns: { default: "minmax(0, 1fr)", [WIDE]: "minmax(0, 1fr) 280px" },
    alignItems: "start",
    gap: settings.sectionGap,
  },
  column: { display: "flex", flexDirection: "column", gap: settings.sectionGap, minWidth: 0 },
  choices: { display: "flex", flexWrap: "wrap", gap: space.s2 },
  replyForm: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    paddingBlockEnd: space.s3,
    paddingInline: settings.rowPaddingInline,
  },
  replyField: { flex: 1, minWidth: 0 },
  quiet: { margin: 0, paddingInline: space.s1, color: role.contentTertiary },
  entryTitle: { display: "inline-flex", alignItems: "center", gap: space.s2 },
  detailText: { margin: 0, color: role.contentSecondary, textWrap: "pretty" },
  instructions: { whiteSpace: "pre-line" },
  reply: { display: "flex", flexDirection: "column", gap: space.s2, color: role.contentSecondary },
  changes: { display: "inline-flex", alignItems: "center", gap: space.s2 },
  docs: { display: "flex", flexDirection: "column", margin: 0, padding: 0, listStyle: "none" },
  doneToggle: { alignSelf: "flex-start", gap: space.s1, paddingInline: space.s1 },
});
