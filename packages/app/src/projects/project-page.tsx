import { projectPrompt } from "@nyte-ai/schema";
import type { ProjectInfo, SessionInfo } from "@nyte-ai/schema";
import { Button } from "@nyte-ai/ui/button";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { Icon } from "@nyte-ai/ui/icon";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { toast } from "@nyte-ai/ui/toast";
import { create, props } from "@stylexjs/stylex";
import { useState } from "react";
import type { ReactElement } from "react";
import { errorMessage } from "../contract/errors.ts";
import { useCatalog } from "../data/catalog.ts";
import { updateProject, useAllProjects } from "../data/projects.ts";
import { useRootRows } from "../data/session-rows.ts";
import { useWorkspaces } from "../data/workspaces.ts";
import { settingsStyles as page } from "../settings/settings.stylex.ts";
import { activateWorkspace } from "../sidebar/use-show-session.ts";
import { shellActions } from "../tabs/shell-state.ts";
import { windowTabs } from "../tabs/window-tabs.ts";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { ProjectEditor } from "./project-editor.tsx";

const NO_ROWS: readonly SessionInfo[] = [];

/** A project's own page, or the page that creates one when `section` is `new`. */
export function ProjectPage({ section }: { readonly section: string }): ReactElement {
  const project = useAllProjects().find((entry) => entry.id === section);

  return (
    <div {...props(page.content)}>
      <div {...props(page.contentInner)}>
        {section === "new" ? (
          <NewProject />
        ) : project === undefined ? (
          <Gone />
        ) : (
          <ProjectView key={project.id} project={project} />
        )}
      </div>
    </div>
  );
}

function NewProject(): ReactElement {
  return (
    <>
      <div {...props(page.titleRow)}>
        <h1 {...props(settingsPatterns.pageTitle)}>New Project</h1>
      </div>
      <p {...props(text.base, styles.lead)}>
        A project has one lead chat that keeps going. Its brief is the lead's system prompt: what
        the project is for and how its work is done. The lead hands each part of the work to a unit,
        a chat you can open and talk to.
      </p>
      <ProjectEditor
        project={null}
        onDone={(saved) =>
          saved === undefined ? shellActions.showWorkspace() : shellActions.openProject(saved.id)
        }
      />
    </>
  );
}

function Gone(): ReactElement {
  return (
    <div {...props(styles.empty)}>
      <span {...props(text.base)}>This project is gone.</span>
      <Button onClick={() => shellActions.openProject("new")}>New Project</Button>
    </div>
  );
}

function ProjectView({ project }: { readonly project: ProjectInfo }): ReactElement {
  const [editing, setEditing] = useState(false);
  const roots = useRootRows() ?? NO_ROWS;
  const folder = useWorkspaces().data?.find((workspace) => workspace.id === project.workspace);
  const models = useCatalog().data?.models ?? [];

  const worker =
    project.worker === null
      ? "the lead's model"
      : (models.find(
          (option) =>
            option.provider === project.worker?.provider && option.id === project.worker.id,
        )?.name ?? project.worker.id);

  const lead = roots.find(
    (session) => session.id === project.lead && session.project === project.id && !session.archived,
  );

  const startChat = async (): Promise<void> => {
    if (folder === undefined || !(await activateWorkspace(folder.path))) return;
    windowTabs.newChat(project.id);
  };

  const archive = async (): Promise<void> => {
    try {
      await updateProject(project.id, { archived: true });
      shellActions.showWorkspace();
    } catch (cause) {
      toast.add({ type: "error", title: errorMessage(cause) });
    }
  };

  if (editing)
    return (
      <>
        <div {...props(page.titleRow)}>
          <h1 {...props(settingsPatterns.pageTitle)}>{project.name}</h1>
        </div>
        <ProjectEditor project={project} onDone={() => setEditing(false)} />
      </>
    );

  return (
    <>
      <header {...props(styles.hero)}>
        <span aria-hidden="true" {...props(styles.tile)}>
          <Icon name="layers" size="md" />
        </span>
        <div {...props(styles.heroText)}>
          <h1 {...props(settingsPatterns.pageTitle)}>{project.name}</h1>
          <p {...props(text.sm, styles.facts)}>
            {project.until.kind === "goal" ? `Until: ${project.until.goal}` : "Standing"}
            {" · "}
            {folder?.name ?? "Folder unavailable"}
            {" · "}
            Units run on {worker}
          </p>
        </div>
        <div {...props(styles.actions)}>
          {lead === undefined ? (
            <Button variant="solid" icon="new-chat" onClick={() => void startChat()}>
              Start Lead Chat
            </Button>
          ) : (
            <>
              <Button
                variant="solid"
                icon="new-chat"
                onClick={() => windowTabs.openChat(lead.id, "permanent")}
              >
                Open Lead Chat
              </Button>
              <Button icon="new-chat" onClick={() => void startChat()}>
                New Unit
              </Button>
            </>
          )}
          <Button icon="pencil" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button
            iconOnly
            icon="archive"
            aria-label="Archive Project"
            onClick={() => void archive()}
          />
        </div>
      </header>

      <section aria-label="Brief" {...props(styles.card)}>
        <div {...props(styles.cardHeader)}>
          <h2 {...props(text.base, styles.cardTitle)}>Brief</h2>
          <span {...props(text.sm, styles.muted)}>
            The lead's system prompt. An edit reaches every chat here from its next message.
          </span>
        </div>
        <p {...props(text.base, styles.brief, project.brief.trim() === "" && styles.muted)}>
          {project.brief.trim() === ""
            ? "No brief yet. The lead will ask what the project is for."
            : project.brief}
        </p>
        <Collapsible.Root>
          <Collapsible.Trigger xstyle={[text.sm, styles.disclosure]}>
            The full prompt the lead reads
            <Collapsible.Chevron />
          </Collapsible.Trigger>
          <Collapsible.Panel>
            <pre {...props(text.code, styles.prompt)}>{projectPrompt(project, "lead")}</pre>
          </Collapsible.Panel>
        </Collapsible.Root>
      </section>
    </>
  );
}

const styles = create({
  lead: { margin: 0, paddingInline: space.s1, color: role.contentSecondary, textWrap: "pretty" },
  hero: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.s3,
    paddingInline: space.s1,
  },
  tile: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: space.s8,
    height: space.s8,
    flexShrink: 0,
    borderRadius: radius.card,
    backgroundColor: role.bgMutedTranslucent,
    color: role.contentPrimary,
  },
  heroText: { display: "flex", flexDirection: "column", gap: space.s0_5, flex: 1, minWidth: 0 },
  facts: { margin: 0, color: role.contentSecondary },
  actions: { display: "flex", flexWrap: "wrap", gap: space.s2 },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    padding: space.s4,
    borderRadius: radius.card,
    backgroundColor: role.bgElevated,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
  },
  cardHeader: { display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: space.s2 },
  cardTitle: { margin: 0, color: role.contentPrimary, fontWeight: type.weightMedium },
  muted: { color: role.contentSecondary },
  brief: { margin: 0, color: role.contentPrimary, whiteSpace: "pre-wrap", textWrap: "pretty" },
  disclosure: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s1,
    color: role.contentSecondary,
  },
  prompt: {
    margin: 0,
    marginBlockStart: space.s2,
    padding: space.s3,
    overflowX: "auto",
    borderRadius: radius.control,
    backgroundColor: role.bgMutedTranslucent,
    color: role.contentSecondary,
    whiteSpace: "pre-wrap",
  },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.s3,
    paddingBlock: space.s8,
    color: role.contentSecondary,
  },
});
