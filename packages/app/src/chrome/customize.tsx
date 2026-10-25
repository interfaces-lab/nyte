import { intent } from "@nyte-ai/ui/surface-theme";
import { props } from "@stylexjs/stylex";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactElement } from "react";
import type {
  CommandInfo,
  HostView,
  Json,
  SessionId,
  SettingInfo,
  SkillInfo,
  ToolInfo,
} from "@nyte-ai/sdk";
import { Button } from "@nyte-ai/ui/button";
import { Icon, type IconName } from "@nyte-ai/ui/icon";
import { Input, InputGroup } from "@nyte-ai/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nyte-ai/ui/select";
import { Switch } from "@nyte-ai/ui/switch";
import { Tabs } from "@nyte-ai/ui/tabs";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import type { ShellSearch } from "../shell/search.ts";
import { nyte } from "../nyte.ts";
import {
  useApplyPluginSetting,
  useHostState,
  usePluginSettingsProjection,
  useWorkspaceCatalog,
} from "../queries.ts";
import { keys } from "../query-keys.ts";
import { connected, hostWatch, mcpWatch, sessionWatch, useWatch, useWatchSelect } from "../sdk.tsx";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { settingsStyles as page } from "../settings/settings.stylex.ts";
import { ConnectionRow, ConnectionStatus } from "./connection-list.tsx";
import { McpServersTab, mcpNeedsAttention } from "./customize-mcp.tsx";
import {
  Chips,
  Details,
  ExpandButton,
  Field,
  ListLoading,
  Notice,
  PathActions,
  Section,
  Wide,
} from "./customize-parts.tsx";
import { customizeStyles as styles } from "./customize.stylex.ts";

interface Presentation {
  readonly name: string;
  readonly description: string;
  readonly icon: IconName;
}

/** The plugins Nyte ships that people use directly; the others are internal and stay hidden unless they fail to load. */
const SHIPPED = new Map<string, Presentation>([
  ["web", { name: "Web", description: "Search the web and read pages", icon: "globe" }],
  [
    "codemode",
    {
      name: "Code mode",
      description: "Run scripts that batch and chain tool calls",
      icon: "brackets",
    },
  ],
  [
    "question",
    {
      name: "Questions",
      description: "Lets the agent ask you to choose",
      icon: "bubble-question",
    },
  ],
  [
    "rename",
    { name: "Chat titles", description: "Names a chat from its first message", icon: "writing" },
  ],
  [
    "openai-compaction",
    {
      name: "Compaction",
      description: "Compacts long chats with OpenAI's native compaction",
      icon: "cube",
    },
  ],
  [
    "browser-tools",
    {
      name: "Browser",
      description: "Opens, reads and drives pages in the Browser tab",
      icon: "website",
    },
  ],
  [
    "canvas",
    { name: "Canvas", description: "Draws interactive canvases in the chat", icon: "canvas-grid" },
  ],
  [
    "claude-code-sdk",
    {
      name: "Claude Code",
      description: "Use Claude Code as a model",
      icon: "provider-claude-code",
    },
  ],
]);

const TABS = [
  { id: "plugins", label: "Plugins" },
  { id: "mcp", label: "MCP servers" },
  { id: "skills", label: "Skills" },
] as const;

type TabId = (typeof TABS)[number]["id"];

type PluginInfo = HostView["plugins"][number];

interface PluginView {
  readonly info: PluginInfo;
  readonly name: string;
  readonly description: string | undefined;
  readonly icon: IconName;
  readonly shipped: boolean;
  readonly failure: string | undefined;
  readonly settings: readonly SettingInfo[];
  readonly commands: readonly CommandInfo[];
  readonly tools: readonly ToolInfo[];
}

interface SkillView {
  readonly info: SkillInfo;
  readonly path: string;
  readonly project: boolean;
}

const ABSOLUTE = /^(?:[A-Za-z]:)?[\\/]/u;

function loadFailure(plugin: PluginInfo): string | undefined {
  const errors = plugin.issues.filter((issue) => issue.severity === "error");

  return errors.length === 0 ? undefined : errors.map((issue) => issue.message).join("\n");
}

function presentPlugin(
  info: PluginInfo,
  owned: {
    readonly settings: readonly SettingInfo[];
    readonly commands: readonly CommandInfo[];
    readonly tools: readonly ToolInfo[];
  },
): PluginView | undefined {
  const shipped = info.source === "builtin" || info.source === "inline";
  const presentation = SHIPPED.get(info.id);
  const failure = loadFailure(info);

  if (shipped && presentation === undefined && failure === undefined) return undefined;
  const owns = (owner: string): boolean => owner === info.id;

  return {
    info,
    name:
      presentation?.name ??
      (info.id === info.path
        ? info.id.slice(Math.max(info.id.lastIndexOf("/"), info.id.lastIndexOf("\\")) + 1)
        : info.id),
    description: presentation?.description,
    icon: presentation?.icon ?? "box-3d",
    shipped,
    failure,
    settings: owned.settings.filter((setting) => owns(setting.owner)),
    commands: owned.commands.filter((command) => owns(command.owner)),
    tools: owned.tools.filter((tool) => owns(tool.owner) && tool.exposure !== "hidden"),
  };
}

function placeSkill(info: SkillInfo, root: string | undefined): SkillView {
  if (ABSOLUTE.test(info.location))
    return {
      info,
      path: info.location,
      project: root !== undefined && info.location.startsWith(`${root}/`),
    };

  return {
    info,
    path: root === undefined ? info.location : `${root.replace(/[\\/]+$/u, "")}/${info.location}`,
    project: true,
  };
}

function matches(query: string, candidates: readonly string[]): boolean {
  return query === "" || candidates.some((candidate) => candidate.toLowerCase().includes(query));
}

function choiceKey(value: Json): string {
  return JSON.stringify(value);
}

function PluginSetting({
  setting,
  disabled,
  onApply,
}: {
  readonly setting: SettingInfo;
  readonly disabled: boolean;
  readonly onApply: (value: Json) => void;
}): ReactElement {
  if (typeof setting.value === "boolean")
    return (
      <Switch
        label={setting.label}
        checked={setting.value}
        disabled={disabled}
        onCheckedChange={(checked) => onApply(checked)}
      />
    );

  const choices = setting.choices ?? [];

  return (
    <Select
      items={choices.map((choice) => ({ value: choiceKey(choice.value), label: choice.label }))}
      disabled={disabled || choices.length === 0}
      value={choiceKey(setting.value)}
      onValueChange={(key) => {
        const choice = choices.find((candidate) => choiceKey(candidate.value) === key);

        if (choice !== undefined) onApply(choice.value);
      }}
    >
      <SelectTrigger aria-label={setting.label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {choices.map((choice) => (
          <SelectItem
            key={choiceKey(choice.value)}
            value={choiceKey(choice.value)}
            label={choice.label}
          >
            {choice.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PluginDetails({
  plugin,
  sessionId,
}: {
  readonly plugin: PluginView;
  readonly sessionId: SessionId | undefined;
}): ReactElement {
  const apply = useApplyPluginSetting(sessionId);
  const { failure, settings, commands, tools } = plugin;
  const path = plugin.info.path;
  const perChat = settings.some((setting) => setting.scope === "session");

  return (
    <Details>
      {failure !== undefined && (
        <Wide>
          <span {...props(styles.stack)}>
            <span {...props(styles.note)}>Nyte tries again when a file in its folder changes.</span>
            <pre {...props(text.sm, styles.trace)}>{failure}</pre>
            <span {...props(styles.actions)}>
              <Button
                variant="outline"
                icon="copy"
                onClick={() => void navigator.clipboard.writeText(failure)}
              >
                Copy Error
              </Button>
            </span>
          </span>
        </Wide>
      )}
      {path !== null && (
        <Field label="Location">
          <PathActions path={path} />
        </Field>
      )}
      {settings.map((setting) => (
        <Field key={setting.id} label={setting.label}>
          <PluginSetting
            setting={setting}
            disabled={(sessionId === undefined && setting.scope === "session") || apply.isPending}
            onApply={(value) => apply.mutate({ id: setting.id, value })}
          />
        </Field>
      ))}
      {settings.length > 0 && (sessionId !== undefined || perChat) && (
        <Wide>
          <span {...props(text.sm, styles.note)}>
            {sessionId === undefined ? "Open a chat to change per-chat settings." : "For this chat"}
          </span>
        </Wide>
      )}
      {commands.length > 0 && (
        <Field label={commands.length === 1 ? "Command" : "Commands"}>
          <Chips
            names={commands.map((command) => `/${command.name}`)}
            label={`${plugin.name} commands`}
          />
        </Field>
      )}
      {tools.length > 0 && (
        <Field label={tools.length === 1 ? "Tool" : "Tools"}>
          <Chips names={tools.map((tool) => tool.name)} label={`${plugin.name} tools`} />
        </Field>
      )}
    </Details>
  );
}

function PluginRow({
  plugin,
  sessionId,
}: {
  readonly plugin: PluginView;
  readonly sessionId: SessionId | undefined;
}): ReactElement {
  const [open, setOpen] = useState(false);

  const expandable =
    plugin.failure !== undefined ||
    plugin.info.path !== null ||
    plugin.settings.length > 0 ||
    plugin.commands.length > 0 ||
    plugin.tools.length > 0;

  return (
    <ConnectionRow
      glyph={<Icon name={plugin.icon} size={16} />}
      title={plugin.name}
      detail={
        plugin.failure !== undefined ? (
          <ConnectionStatus tone="err">Couldn&rsquo;t load</ConnectionStatus>
        ) : (
          plugin.description
        )
      }
      control={
        expandable ? (
          <ExpandButton name={plugin.name} open={open} onToggle={() => setOpen((was) => !was)} />
        ) : undefined
      }
      expansion={open ? <PluginDetails plugin={plugin} sessionId={sessionId} /> : undefined}
    />
  );
}

function PluginsTab({
  plugins,
  term,
  sessionId,
}: {
  readonly plugins: readonly PluginView[];
  readonly term: string;
  readonly sessionId: SessionId | undefined;
}): ReactElement {
  const openPluginsFolder = nyte.host.openPluginsFolder;
  const builtIn = plugins.filter((plugin) => plugin.shipped);
  const yours = plugins.filter((plugin) => !plugin.shipped);
  const adding = term === "" ? openPluginsFolder : undefined;

  if (plugins.length === 0 && term !== "")
    return <Notice>No plugins match &ldquo;{term}&rdquo;</Notice>;

  return (
    <>
      {builtIn.length > 0 && (
        <Section title="Built in">
          {builtIn.map((plugin) => (
            <PluginRow key={plugin.info.id} plugin={plugin} sessionId={sessionId} />
          ))}
        </Section>
      )}
      {(yours.length > 0 || adding !== undefined) && (
        <Section title="Yours">
          {yours.map((plugin) => (
            <PluginRow key={plugin.info.id} plugin={plugin} sessionId={sessionId} />
          ))}
          {adding !== undefined && (
            <ConnectionRow
              glyph={<Icon name="folder-add" size={16} />}
              title="Add your own plugin"
              control={
                <Button variant="outline" icon="folder-open" onClick={() => void adding()}>
                  Open Plugins Folder
                </Button>
              }
            />
          )}
        </Section>
      )}
    </>
  );
}

function SkillRow({ skill }: { readonly skill: SkillView }): ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <ConnectionRow
      glyph={<Icon name="skills" size={16} />}
      title={skill.info.name}
      detail={skill.info.description === "" ? undefined : skill.info.description}
      control={
        <ExpandButton name={skill.info.name} open={open} onToggle={() => setOpen((was) => !was)} />
      }
      expansion={
        open ? (
          <Details>
            <Field label="File">
              <PathActions path={skill.path} />
            </Field>
          </Details>
        ) : undefined
      }
    />
  );
}

function SkillsTab({
  skills,
  term,
}: {
  readonly skills: readonly SkillView[];
  readonly term: string;
}): ReactElement {
  const project = skills.filter((skill) => skill.project);
  const yours = skills.filter((skill) => !skill.project);

  if (skills.length === 0)
    return term === "" ? (
      <Notice>
        No skills yet. Add a folder with a SKILL.md to .agents/skills here or in your home folder.
      </Notice>
    ) : (
      <Notice>No skills match &ldquo;{term}&rdquo;</Notice>
    );

  return (
    <>
      {project.length > 0 && (
        <Section title="This project" description="In .nyte/skills or .agents/skills">
          {project.map((skill) => (
            <SkillRow key={skill.info.location} skill={skill} />
          ))}
        </Section>
      )}
      {yours.length > 0 && (
        <Section title="Yours" description="In ~/.nyte/skills or ~/.agents/skills">
          {yours.map((skill) => (
            <SkillRow key={skill.info.location} skill={skill} />
          ))}
        </Section>
      )}
    </>
  );
}

export function CustomizeSurface({
  sessionId,
}: {
  sessionId: SessionId | undefined;
}): ReactElement {
  const section = useSearch({ from: "__root__", select: (search) => search.customize });
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const term = search.trim();
  const query = term.toLowerCase();
  const tab = TABS.find((candidate) => candidate.id === section)?.id ?? "plugins";
  const projectSettings = usePluginSettingsProjection(sessionId);
  const selected = useHostState().data.workspace;
  const hostPlugins = useWatchSelect(hostWatch("host"), (state) => state.value?.plugins);
  const hostSettings = useWatchSelect(hostWatch("host"), (state) => state.value?.settings);

  const home = useWatchSelect(
    hostWatch("host"),
    (state) => state.value?.defaultWorkspace ?? undefined,
  );

  const workspace = selected?.id ?? home;

  const homeInfo = useQuery({
    queryKey: keys.workspaceInfo(home),
    queryFn:
      selected !== undefined || home === undefined
        ? skipToken
        : async () => (await connected()).workspace(home).info(),
    staleTime: 60_000,
  });

  const target = homeInfo.data?.target;

  const root =
    selected?.path ?? (target !== undefined && "path" in target ? target.path : undefined);

  const workspaceCatalog = useWorkspaceCatalog(workspace);
  const mcp = useWatch(workspace === undefined ? undefined : mcpWatch(workspace));

  const catalog = useWatchSelect(
    sessionId === undefined ? undefined : sessionWatch(sessionId),
    (state) => state.value?.catalog,
  );

  const owned = {
    settings: projectSettings(catalog?.settings ?? hostSettings ?? []),
    commands: catalog?.commands ?? workspaceCatalog.data?.commands ?? [],
    tools: catalog?.tools ?? [],
  };

  const plugins =
    hostPlugins === undefined || hostSettings === undefined
      ? undefined
      : hostPlugins.flatMap((info) => presentPlugin(info, owned) ?? []);

  const skills = workspaceCatalog.data?.skills.map((skill) => placeSkill(skill, root));

  const shown = {
    plugins: plugins?.filter((plugin) =>
      matches(query, [
        plugin.name,
        plugin.info.id,
        plugin.description ?? "",
        ...plugin.commands.map((command) => command.name),
        ...plugin.tools.map((tool) => tool.name),
      ]),
    ),
    mcp: mcp.value?.servers.filter((server) =>
      matches(query, [
        server.name,
        server.description ?? "",
        ...(server.state.kind === "connected" ? server.state.tools.map((tool) => tool.name) : []),
      ]),
    ),
    skills: skills?.filter((skill) => matches(query, [skill.info.name, skill.info.description])),
  } satisfies Record<TabId, readonly unknown[] | undefined>;

  const issues = term === "" ? (mcp.value?.issues ?? []) : [];

  const attention = {
    plugins: shown.plugins?.some((plugin) => plugin.failure !== undefined) ?? false,
    mcp: issues.length > 0 || (shown.mcp?.some(mcpNeedsAttention) ?? false),
    skills: false,
  } satisfies Record<TabId, boolean>;

  const show = (next: TabId): void =>
    void navigate({
      to: ".",
      search: (previous: ShellSearch) => ({ ...previous, customize: next }),
    });

  return (
    <div data-nyte-customize-surface {...props(page.content)}>
      <div {...props(page.contentInner)}>
        <div {...props(styles.header)}>
          <div {...props(page.titleRow)}>
            <h1 {...props(settingsPatterns.pageTitle)}>Customize</h1>
          </div>
          <div {...props(styles.toolbar)}>
            <Tabs.Root
              variant="pill"
              value={tab}
              onValueChange={(value) => {
                const next = TABS.find((candidate) => candidate.id === value);

                if (next !== undefined) show(next.id);
              }}
            >
              <Tabs.List aria-label="Customize">
                {TABS.map((candidate) => {
                  const count = shown[candidate.id]?.length;

                  return (
                    <Tabs.Tab key={candidate.id} value={candidate.id}>
                      {candidate.label}
                      {count !== undefined && <span {...props(styles.count)}>{count}</span>}
                      {attention[candidate.id] && (
                        <>
                          <span aria-hidden="true" {...props(intent.warning, styles.attention)} />
                          <span {...props(srOnly)}>, needs attention</span>
                        </>
                      )}
                    </Tabs.Tab>
                  );
                })}
              </Tabs.List>
            </Tabs.Root>
            <InputGroup variant="quiet" xstyle={styles.search}>
              <span {...props(styles.searchIcon)}>
                <Icon name="search" size={14} />
              </span>
              <Input
                type="search"
                aria-label="Search Customize"
                autoComplete="off"
                spellCheck={false}
                placeholder="Search"
                value={search}
                onValueChange={setSearch}
              />
            </InputGroup>
          </div>
        </div>

        {tab === "plugins" &&
          (shown.plugins === undefined ? (
            <ListLoading />
          ) : (
            <PluginsTab plugins={shown.plugins} term={term} sessionId={sessionId} />
          ))}

        {tab === "mcp" &&
          (workspace === undefined ? (
            <Notice>Open a folder to see its MCP servers.</Notice>
          ) : mcp.error !== undefined ? (
            <Notice>
              Couldn&rsquo;t load MCP servers.{" "}
              <Button variant="outline" onClick={mcp.retry}>
                Try Again
              </Button>
            </Notice>
          ) : shown.mcp === undefined || mcp.value === undefined ? (
            <ListLoading />
          ) : (
            <McpServersTab workspace={workspace} servers={shown.mcp} issues={issues} term={term} />
          ))}

        {tab === "skills" &&
          (workspace === undefined ? (
            <Notice>Open a folder to see its skills.</Notice>
          ) : workspaceCatalog.isError ? (
            <Notice>
              Couldn&rsquo;t list this folder&rsquo;s skills.{" "}
              <Button variant="outline" onClick={() => void workspaceCatalog.refetch()}>
                Try Again
              </Button>
            </Notice>
          ) : shown.skills === undefined ? (
            <ListLoading />
          ) : (
            <SkillsTab skills={shown.skills} term={term} />
          ))}
      </div>
    </div>
  );
}
