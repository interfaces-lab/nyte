import type {
  ModelRef,
  ProjectId,
  ProjectInfo,
  ProjectInput,
  ContextFile,
  SharedDoc,
  WorkspaceId,
} from "@nyte-ai/schema";
import {
  Autocomplete,
  AutocompleteContent,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompleteTrigger,
} from "@nyte-ai/ui/autocomplete";
import { Button } from "@nyte-ai/ui/button";
import { Dialog } from "@nyte-ai/ui/dialog";
import { Input, Textarea } from "@nyte-ai/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nyte-ai/ui/select";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { SwitchField } from "@nyte-ai/ui/switch";
import { Tabs } from "@nyte-ai/ui/tabs";
import { toast } from "@nyte-ai/ui/toast";
import { create, props } from "@stylexjs/stylex";
import { useMutation } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import { errorMessage } from "../contract/errors.ts";
import { useCatalog } from "../data/catalog.ts";
import { connected } from "../data/connection.ts";
import { useHostState } from "../data/host.ts";
import { useWorkspaceCatalog } from "../data/plugins.ts";
import { createProject, updateProject, useProjects } from "../data/projects.ts";
import { useWatch } from "../data/watch-store.ts";
import { mcpWatch } from "../data/watches.ts";
import { useWorkspaces } from "../data/workspaces.ts";
import type { RailWorkspace } from "../data/workspaces.ts";
import { openProject } from "./open-project.ts";

type ProjectTab = "general" | "agents" | "instructions" | "skills" | "mcp" | "docs";

const TABS: readonly { readonly value: ProjectTab; readonly label: string }[] = [
  { value: "general", label: "General" },
  { value: "agents", label: "Agents" },
  { value: "instructions", label: "Instructions" },
  { value: "skills", label: "Skills" },
  { value: "mcp", label: "MCP" },
  { value: "docs", label: "Context" },
];

const DEFAULT_MODEL = "";

type Draft = Omit<ProjectInput, "workspace"> & { readonly workspace: WorkspaceId | undefined };

type Opened = { readonly project: ProjectId | null };

let opened: Opened | undefined;

const listeners = new Set<() => void>();

export function openProjectDialog(project: ProjectId | null): void {
  opened = { project };

  for (const listener of listeners) listener();
}

function closeProjectDialog(): void {
  opened = undefined;

  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function ProjectDialogHost(): ReactElement | null {
  const current = useSyncExternalStore(subscribe, () => opened);
  const project = useProjects().find((entry) => entry.id === current?.project);

  if (current === undefined || (current.project !== null && project === undefined)) return null;

  return <ProjectDialog key={current.project ?? "new"} project={project ?? null} />;
}

function ProjectDialog({ project }: { readonly project: ProjectInfo | null }): ReactElement {
  const folders = (useWorkspaces().data ?? []).filter((workspace) => workspace.worktree === null);
  const fallback = useHostState().data.workspace?.id ?? folders[0]?.id;
  const [edited, setDraft] = useState<Draft>(() => readDraft(project));
  const draft = { ...edited, workspace: edited.workspace ?? fallback };
  const [tab, setTab] = useState<ProjectTab>("general");
  const [submitted, setSubmitted] = useState(false);
  const nameMissing = draft.name.trim() === "";

  const save = useMutation({
    mutationFn: async (next: Draft): Promise<ProjectInfo> => {
      if (next.workspace === undefined) throw new Error("Choose a folder.");
      const fields = { ...next, name: next.name.trim(), workspace: next.workspace };

      if (project === null) return createProject(fields);

      const saved = await updateProject(project.id, {
        name: fields.name,
        models: fields.models,
        instructions: fields.instructions,
        skills: fields.skills,
        disabledMcp: fields.disabledMcp,
        disabledDocs: fields.disabledDocs,
      });

      const model = saved.models.coordinator;

      if (
        saved.coordinator !== null &&
        model !== null &&
        JSON.stringify(model) !== JSON.stringify(project.models.coordinator)
      )
        await (await connected()).session(saved.coordinator).configure({ model });

      return saved;
    },
    onSuccess: (saved) => {
      closeProjectDialog();

      if (project === null) void openProject(saved);
    },
    onError: (cause) => toast.add({ type: "error", title: errorMessage(cause) }),
  });

  const archive = useMutation({
    mutationFn: (id: ProjectId) => updateProject(id, { archived: true }),
    onSuccess: closeProjectDialog,
    onError: (cause) => toast.add({ type: "error", title: errorMessage(cause) }),
  });

  const pending = save.isPending || archive.isPending;

  const submit = (): void => {
    setSubmitted(true);

    if (nameMissing) {
      setTab("general");

      return;
    }

    save.mutate(draft);
  };

  return (
    <Dialog.Root defaultOpen onOpenChange={(open) => !open && !pending && closeProjectDialog()}>
      <Dialog.Popup xstyle={styles.popup} aria-busy={pending}>
        <Dialog.Header>
          <Dialog.Title>{project === null ? "New Project" : project.name}</Dialog.Title>
        </Dialog.Header>
        <form
          {...props(styles.form)}
          onSubmit={(event) => {
            event.preventDefault();

            if (!pending) submit();
          }}
        >
          <Tabs.Root
            value={tab}
            onValueChange={(next) =>
              setTab(TABS.find((entry) => entry.value === next)?.value ?? tab)
            }
            xstyle={styles.tabs}
          >
            <Tabs.List aria-label="Project settings" xstyle={styles.tabList}>
              {TABS.map((entry) => (
                <Tabs.Tab key={entry.value} value={entry.value}>
                  {entry.label}
                </Tabs.Tab>
              ))}
            </Tabs.List>
            <Tabs.Panel value="general" xstyle={styles.panel}>
              <GeneralTab
                draft={draft}
                folders={folders}
                creating={project === null}
                nameIssue={submitted && nameMissing ? "Enter a name" : undefined}
                onChange={setDraft}
              />
            </Tabs.Panel>
            <Tabs.Panel value="agents" xstyle={styles.panel}>
              <AgentsTab draft={draft} onChange={setDraft} />
            </Tabs.Panel>
            <Tabs.Panel value="instructions" xstyle={styles.panel}>
              <Field label="Additional instructions" hint="Every chat in the project reads these.">
                <Textarea
                  aria-label="Additional instructions"
                  rows={10}
                  value={draft.instructions}
                  placeholder="How work is done here, e.g. Read nyte-styles before touching StyleX. Run pnpm check before you report."
                  onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
                />
              </Field>
            </Tabs.Panel>
            <Tabs.Panel value="skills" xstyle={styles.panel}>
              <SkillsTab draft={draft} onChange={setDraft} />
            </Tabs.Panel>
            <Tabs.Panel value="mcp" xstyle={styles.panel}>
              <McpTab draft={draft} onChange={setDraft} />
            </Tabs.Panel>
            <Tabs.Panel value="docs" xstyle={styles.panel}>
              <DocsTab draft={draft} onChange={setDraft} />
            </Tabs.Panel>
          </Tabs.Root>
          <Dialog.Footer>
            {project !== null && (
              <Button
                tone="danger"
                variant="ghost"
                disabled={pending}
                loading={archive.isPending}
                xstyle={styles.archive}
                onClick={() => archive.mutate(project.id)}
              >
                Archive Project
              </Button>
            )}
            <Dialog.Close
              render={
                <Button variant="outline" disabled={pending}>
                  Cancel
                </Button>
              }
            />
            <Button type="submit" variant="solid" tone="primary" loading={save.isPending}>
              {project === null ? "Create Project" : "Save"}
            </Button>
          </Dialog.Footer>
        </form>
      </Dialog.Popup>
    </Dialog.Root>
  );
}

function GeneralTab({
  draft,
  folders,
  creating,
  nameIssue,
  onChange,
}: {
  readonly draft: Draft;
  readonly folders: readonly RailWorkspace[];
  readonly creating: boolean;
  readonly nameIssue: string | undefined;
  readonly onChange: (draft: Draft) => void;
}): ReactElement {
  const items = folders.map((workspace) => ({ value: workspace.id, label: workspace.name }));

  return (
    <>
      <Field label="Name" issue={nameIssue}>
        <Input
          autoFocus
          aria-label="Name"
          aria-invalid={nameIssue !== undefined}
          value={draft.name}
          placeholder="e.g. UI Polish"
          onValueChange={(name) => onChange({ ...draft, name })}
        />
      </Field>
      <Field
        label="Folder"
        hint={creating ? undefined : "A project stays in the folder it was made in."}
      >
        <Select
          items={items}
          value={draft.workspace ?? null}
          disabled={!creating}
          onValueChange={(next) =>
            onChange({ ...draft, workspace: folders.find((entry) => entry.id === next)?.id })
          }
        >
          <SelectTrigger aria-label="Folder" width="wide">
            <SelectValue placeholder="Choose a folder" />
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value} label={item.label}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </>
  );
}

function AgentsTab({
  draft,
  onChange,
}: {
  readonly draft: Draft;
  readonly onChange: (draft: Draft) => void;
}): ReactElement {
  const models = (useCatalog().data?.models ?? []).filter((option) => option.listed);

  const items = [
    { value: DEFAULT_MODEL, label: "Default model" },
    ...models.map((option) => ({ value: option.key, label: option.name })),
  ];

  const pick = (key: string): ModelRef | null => {
    const found = models.find((option) => option.key === key);

    return found === undefined ? null : { provider: found.provider, id: found.id };
  };

  const picker = (
    label: string,
    value: ModelRef | null,
    change: (model: ModelRef | null) => void,
  ) => (
    <Select
      items={items}
      value={value === null ? DEFAULT_MODEL : `${value.provider}/${value.id}`}
      onValueChange={(next) => change(pick(next ?? DEFAULT_MODEL))}
    >
      <SelectTrigger aria-label={label} width="wide">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value} label={item.label}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <>
      <Field label="Coordinator" hint="The project's chat. It plans the work and starts agents.">
        {picker("Coordinator", draft.models.coordinator, (coordinator) =>
          onChange({ ...draft, models: { ...draft.models, coordinator } }),
        )}
      </Field>
      <Field label="Agents" hint="Each agent is a chat of its own that you can open and talk to.">
        {picker("Agents", draft.models.agents, (agents) =>
          onChange({ ...draft, models: { ...draft.models, agents } }),
        )}
      </Field>
    </>
  );
}

function SkillsTab({
  draft,
  onChange,
}: {
  readonly draft: Draft;
  readonly onChange: (draft: Draft) => void;
}): ReactElement {
  const catalog = useWorkspaceCatalog(draft.workspace);
  const skills = catalog.data?.skills ?? [];
  const [search, setSearch] = useState("");
  const names = skills.map((skill) => skill.name);

  const chosen = draft.skills.map(
    (name) =>
      skills.find((skill) => skill.name === name) ?? {
        name,
        description: "Not found in this folder",
      },
  );

  return (
    <Field
      label="Preloaded skills"
      hint="Their files go into every chat's context, so agents don't have to find them."
    >
      <Autocomplete
        multiple
        items={names}
        value={[...draft.skills]}
        inputValue={search}
        autoHighlight
        onValueChange={(next) => onChange({ ...draft, skills: next })}
        onInputValueChange={setSearch}
      >
        <AutocompleteTrigger aria-label="Preloaded skills" width="wide">
          {catalog.isPending ? "Loading skills…" : "Add a skill"}
        </AutocompleteTrigger>
        <AutocompleteContent>
          <AutocompleteInput aria-label="Search skills" placeholder="Search skills" />
          <AutocompleteList data-nyte-scrollport>
            {(name: string) => (
              <AutocompleteItem key={name} value={name}>
                {name}
              </AutocompleteItem>
            )}
          </AutocompleteList>
          <AutocompleteEmpty>
            {names.length === 0 ? "No skills in this folder" : `No skills match “${search}”`}
          </AutocompleteEmpty>
        </AutocompleteContent>
      </Autocomplete>
      {chosen.length > 0 && (
        <ul {...props(styles.list)}>
          {chosen.map((skill) => (
            <li key={skill.name} {...props(styles.item)}>
              <span {...props(styles.itemText)}>
                <span {...props(text.base, styles.itemName)}>{skill.name}</span>
                {skill.description !== "" && (
                  <span {...props(text.sm, styles.hint)}>{skill.description}</span>
                )}
              </span>
              <Button
                size="sm"
                iconOnly
                icon="x"
                aria-label={`Remove ${skill.name}`}
                onClick={() =>
                  onChange({ ...draft, skills: draft.skills.filter((name) => name !== skill.name) })
                }
              />
            </li>
          ))}
        </ul>
      )}
    </Field>
  );
}

function McpTab({
  draft,
  onChange,
}: {
  readonly draft: Draft;
  readonly onChange: (draft: Draft) => void;
}): ReactElement {
  const mcp = useWatch(draft.workspace === undefined ? undefined : mcpWatch(draft.workspace));
  const servers = mcp.value?.servers ?? [];

  if (mcp.value === undefined && mcp.error === undefined)
    return <Notice>Loading MCP servers…</Notice>;

  if (servers.length === 0)
    return <Notice>No MCP servers in this folder. Add them in Customize.</Notice>;

  return (
    <div {...props(styles.switches)}>
      <span {...props(text.sm, styles.hint)}>The project's chats get the servers turned on.</span>
      {servers.map((server) => (
        <SwitchField
          key={server.name}
          label={server.name}
          description={server.description ?? undefined}
          checked={!draft.disabledMcp.includes(server.name)}
          onCheckedChange={(on) =>
            onChange({ ...draft, disabledMcp: toggle(draft.disabledMcp, server.name, !on) })
          }
        />
      ))}
    </div>
  );
}

const RULE_SCOPES = {
  user: () => "Yours, in ~/.nyte",
  ancestor: (location: string) => `Above this folder, ${location}`,
  project: () => "This folder",
} as const satisfies Record<ContextFile["scope"], (location: string) => string>;

function DocsTab({
  draft,
  onChange,
}: {
  readonly draft: Draft;
  readonly onChange: (draft: Draft) => void;
}): ReactElement {
  const catalog = useWorkspaceCatalog(draft.workspace);
  const docs = catalog.data?.docs ?? [];
  const rules = catalog.data?.contextFiles ?? [];

  if (catalog.isPending && draft.workspace !== undefined) return <Notice>Loading context…</Notice>;

  const entry = (id: string, label: string, description: string | undefined): ReactNode => (
    <SwitchField
      key={id}
      label={label}
      description={description}
      checked={!draft.disabledDocs.includes(id)}
      onCheckedChange={(on) =>
        onChange({ ...draft, disabledDocs: toggle(draft.disabledDocs, id, !on) })
      }
    />
  );

  const group = (title: string, where: string, scoped: readonly SharedDoc[]): ReactNode =>
    scoped.length > 0 && (
      <div {...props(styles.switches)}>
        <span {...props(text.sm, styles.groupTitle)}>
          {title} <span {...props(styles.hint)}>{where}</span>
        </span>
        {scoped.map((doc) =>
          entry(doc.id, doc.name, doc.description === "" ? undefined : doc.description),
        )}
      </div>
    );

  return (
    <div {...props(styles.switches)}>
      {rules.length > 0 && (
        <div {...props(styles.switches)}>
          <span {...props(text.sm, styles.groupTitle)}>Rules</span>
          {rules.map((rule) => entry(rule.id, rule.name, RULE_SCOPES[rule.scope](rule.location)))}
        </div>
      )}
      <span {...props(text.sm, styles.groupTitle)}>Shared docs</span>
      <span {...props(text.sm, styles.hint)}>
        Agents read these before they start and add what they learn.
      </span>
      {docs.length === 0 ? (
        <Notice>
          Nothing shared yet. Agents add files to .nyte/projects/docs as they learn how this
          codebase works.
        </Notice>
      ) : (
        <>
          {group(
            "This folder",
            ".nyte/projects/docs",
            docs.filter((doc) => doc.scope === "project"),
          )}
          {group(
            "Yours",
            "~/.nyte/projects/docs",
            docs.filter((doc) => doc.scope === "user"),
          )}
        </>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  issue,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly issue?: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div {...props(styles.field)}>
      <span {...props(text.sm, styles.label)}>{label}</span>
      {children}
      {issue === undefined ? (
        hint !== undefined && <span {...props(text.sm, styles.hint)}>{hint}</span>
      ) : (
        <span role="alert" {...props(text.sm, intent.danger, styles.issue)}>
          {issue}
        </span>
      )}
    </div>
  );
}

function Notice({ children }: { readonly children: ReactNode }): ReactElement {
  return <p {...props(text.base, styles.notice)}>{children}</p>;
}

function readDraft(project: ProjectInfo | null): Draft {
  return {
    name: project?.name ?? "",
    workspace: project?.workspace,
    models: project?.models ?? { coordinator: null, agents: null },
    instructions: project?.instructions ?? "",
    skills: project?.skills ?? [],
    disabledMcp: project?.disabledMcp ?? [],
    disabledDocs: project?.disabledDocs ?? [],
  };
}

function toggle(list: readonly string[], item: string, present: boolean): readonly string[] {
  const rest = list.filter((entry) => entry !== item);

  return present ? [...rest, item] : rest;
}

const styles = create({
  popup: { width: "min(560px, calc(100vw - 48px))", gap: space.s3 },
  form: { display: "flex", flexDirection: "column", gap: space.s4, minWidth: 0 },
  tabs: { display: "flex", flexDirection: "column", gap: space.s4, minWidth: 0 },
  tabList: { flexWrap: "wrap" },
  panel: {
    display: { default: "flex", "[hidden]": "none" },
    flexDirection: "column",
    gap: space.s4,
    minHeight: 280,
    minWidth: 0,
  },
  field: { display: "flex", flexDirection: "column", gap: space.s1_5, minWidth: 0 },
  label: { color: role.contentPrimary, fontWeight: type.weightMedium },
  hint: { color: role.contentTertiary, overflowWrap: "anywhere" },
  issue: { color: role.contentAccent },
  groupTitle: { color: role.contentPrimary, fontWeight: type.weightMedium },
  switches: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0 },
  list: {
    display: "flex",
    flexDirection: "column",
    margin: 0,
    padding: 0,
    listStyle: "none",
    borderRadius: radius.control,
    boxShadow: `inset 0 0 0 1px ${role.strokeQuaternary}`,
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    paddingBlock: space.s2,
    paddingInline: space.s3,
    borderBlockStartWidth: { default: 1, ":first-child": 0 },
    borderBlockStartStyle: "solid",
    borderBlockStartColor: role.strokeQuaternary,
  },
  itemText: { display: "flex", flexDirection: "column", gap: space.s0_5, flex: 1, minWidth: 0 },
  itemName: { color: role.contentPrimary },
  notice: { margin: 0, color: role.contentSecondary, textWrap: "pretty" },
  archive: { marginInlineEnd: "auto" },
});
