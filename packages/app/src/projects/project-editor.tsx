import { Button } from "@nyte-ai/ui/button";
import { Input, Textarea } from "@nyte-ai/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nyte-ai/ui/select";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { radius } from "@nyte-ai/ui/styles/schema.stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { toast } from "@nyte-ai/ui/toast";
import { create, props } from "@stylexjs/stylex";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent, ReactElement } from "react";
import type { ModelRef, ProjectInfo, ProjectInput, WorkspaceId } from "@nyte-ai/schema";
import { errorMessage } from "../contract/errors.ts";
import { useCatalog } from "../data/catalog.ts";
import { useHostState } from "../data/host.ts";
import { createProject, updateProject } from "../data/projects.ts";
import { useWorkspaces } from "../data/workspaces.ts";

/** The lead's own model, as the worker picker's key. */
const LEADS = "";

/** What the form holds; `goal` is null for a standing project. */
interface Draft {
  readonly name: string;
  readonly brief: string;
  readonly goal: string | null;
  readonly workspace: WorkspaceId | undefined;
  readonly worker: string;
}

/** Creates a project, or edits one in place; `onDone` gets the project as stored, or nothing on cancel. */
export function ProjectEditor({
  project,
  onDone,
}: {
  readonly project: ProjectInfo | null;
  readonly onDone: (saved: ProjectInfo | undefined) => void;
}): ReactElement {
  const folder = useHostState().data.workspace?.id;
  const folders = (useWorkspaces().data ?? []).filter((workspace) => workspace.worktree === null);
  const models = (useCatalog().data?.models ?? []).filter((option) => option.listed);
  const [draft, setDraft] = useState<Draft>(() => readDraft(project, folder));
  const [submitted, setSubmitted] = useState(false);
  const issue = draftIssue(draft);

  const save = useMutation({
    mutationFn: async (next: Draft) => {
      const worker = findWorker(models, next.worker);

      if (project !== null)
        return updateProject(project.id, {
          name: next.name.trim(),
          brief: next.brief,
          until: readUntil(next),
          worker,
        });

      if (next.workspace === undefined) throw new Error("Choose a folder.");

      const input: ProjectInput = {
        name: next.name.trim(),
        brief: next.brief,
        until: readUntil(next),
        workspace: next.workspace,
        worker,
      };

      return createProject(input);
    },
    onSuccess: (saved) => onDone(saved),
    onError: (cause) => toast.add({ type: "error", title: errorMessage(cause) }),
  });

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setSubmitted(true);

    if (issue === undefined) save.mutate(draft);
  };

  const workerItems = [
    { value: LEADS, label: "The lead's model" },
    ...models.map((option) => ({ value: option.key, label: option.name })),
  ];

  const folderItems = folders.map((workspace) => ({ value: workspace.id, label: workspace.name }));

  const untilItems = [
    { value: "standing", label: "Standing" },
    { value: "goal", label: "Until a goal" },
  ];

  return (
    <form
      aria-label={project === null ? "New project" : `Edit ${project.name}`}
      onSubmit={submit}
      {...props(styles.editor)}
    >
      <div {...props(styles.band)}>
        <span {...props(text.sm, styles.label)}>Name</span>
        <Input
          autoFocus
          aria-label="Name"
          value={draft.name}
          placeholder="e.g. Bug Fix and Polish"
          aria-invalid={submitted && issue !== undefined}
          onValueChange={(name) => setDraft({ ...draft, name })}
        />
        {submitted && issue !== undefined && (
          <span {...props(intent.danger, text.sm, styles.issue)}>{issue}</span>
        )}
      </div>
      <div {...props(styles.band, styles.fields)}>
        {project === null && (
          <Field label="Folder">
            <Select
              items={folderItems}
              value={draft.workspace ?? ""}
              onValueChange={(next) =>
                setDraft({ ...draft, workspace: folders.find((entry) => entry.id === next)?.id })
              }
            >
              <SelectTrigger aria-label="Folder" width="wide">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {folderItems.map((item) => (
                  <SelectItem key={item.value} value={item.value} label={item.label}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        <Field label="Runs">
          <Select
            items={untilItems}
            value={draft.goal === null ? "standing" : "goal"}
            onValueChange={(next) =>
              setDraft({ ...draft, goal: next === "goal" ? (draft.goal ?? "") : null })
            }
          >
            <SelectTrigger aria-label="Runs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {untilItems.map((item) => (
                <SelectItem key={item.value} value={item.value} label={item.label}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Units run on">
          <Select
            items={workerItems}
            value={draft.worker}
            onValueChange={(next) =>
              setDraft({
                ...draft,
                worker: workerItems.find((item) => item.value === next)?.value ?? LEADS,
              })
            }
          >
            <SelectTrigger aria-label="Units run on" width="wide">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {workerItems.map((item) => (
                <SelectItem key={item.value} value={item.value} label={item.label}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      {draft.goal !== null && (
        <div {...props(styles.band)}>
          <span {...props(text.sm, styles.label)}>Goal</span>
          <Input
            aria-label="Goal"
            value={draft.goal}
            placeholder="What done looks like, e.g. Ship projects in 0.1"
            onValueChange={(goal) => setDraft({ ...draft, goal })}
          />
        </div>
      )}
      <div {...props(styles.band)}>
        <span {...props(text.sm, styles.label)}>Brief</span>
        <Textarea
          aria-label="Brief"
          rows={14}
          value={draft.brief}
          placeholder="What the project is for and how its work is done: who writes, who reviews, which skills to read first, how commits and pull requests go"
          onChange={(event) => setDraft({ ...draft, brief: event.target.value })}
        />
      </div>
      <div {...props(styles.band, styles.footer)}>
        <Button onClick={() => onDone(undefined)}>Cancel</Button>
        <Button variant="solid" type="submit" loading={save.isPending}>
          {project === null ? "Create Project" : "Save"}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactElement;
}): ReactElement {
  return (
    <label {...props(styles.field)}>
      <span {...props(text.sm, styles.label)}>{label}</span>
      {children}
    </label>
  );
}

function readDraft(project: ProjectInfo | null, folder: WorkspaceId | undefined): Draft {
  return {
    name: project?.name ?? "",
    brief: project?.brief ?? "",
    goal: project === null || project.until.kind === "standing" ? null : project.until.goal,
    workspace: project?.workspace ?? folder,
    worker:
      project?.worker === null || project === null
        ? LEADS
        : `${project.worker.provider}/${project.worker.id}`,
  };
}

function draftIssue(draft: Draft): string | undefined {
  if (draft.name.trim() === "") return "Enter a name";

  return draft.goal !== null && draft.goal.trim() === ""
    ? "Enter the goal, or make it standing"
    : undefined;
}

function readUntil(draft: Draft): ProjectInfo["until"] {
  return draft.goal === null ? { kind: "standing" } : { kind: "goal", goal: draft.goal.trim() };
}

function findWorker(
  models: readonly { readonly key: string; readonly provider: string; readonly id: string }[],
  key: string,
): ModelRef | null {
  const found = models.find((option) => option.key === key);

  return found === undefined ? null : { provider: found.provider, id: found.id };
}

const styles = create({
  editor: {
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    borderRadius: radius.card,
    backgroundColor: role.bgElevated,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
  },
  band: {
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: space.s2,
    padding: space.s4,
    borderBlockStartWidth: { default: 1, ":first-child": 0 },
    borderBlockStartStyle: "solid",
    borderBlockStartColor: role.borderSecondaryTranslucent,
  },
  fields: { flexDirection: "row", flexWrap: "wrap", gap: space.s4 },
  field: { display: "flex", flexDirection: "column", gap: space.s1 },
  label: { color: role.contentSecondary },
  issue: { color: role.contentInteractivePrimary },
  footer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    backgroundColor: role.bgMutedTranslucent,
  },
});
