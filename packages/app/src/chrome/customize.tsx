import { intent } from "@nyte-ai/ui/surface-theme";
import { props } from "@stylexjs/stylex";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import type { PluginInfo, SessionId, SettingInfo } from "@nyte-ai/protocol";
import type { Skill } from "@nyte-ai/schema";
import { Button } from "@nyte-ai/ui/button";
import { Icon, type IconName } from "@nyte-ai/ui/icon";
import { Input, InputGroup } from "@nyte-ai/ui/input";
import { Row } from "@nyte-ai/ui/row";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nyte-ai/ui/select";
import { revealLabel } from "../components/context-menu.ts";
import { nyte } from "../nyte.ts";
import {
  keys,
  useApplyPluginSetting,
  useHostState,
  usePluginSettingsProjection,
  type CustomizeInventory,
} from "../queries.ts";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { ConnectionList, ConnectionRow, ConnectionStatus } from "./connection-list.tsx";
import { SettingsRow, SettingsSwitchRow } from "./settings-controls.tsx";
import { customizeStyles as styles } from "./customize.stylex.ts";

interface Presentation {
  readonly name: string;
  readonly description: string;
  readonly icon: IconName;
}

/**
 * Built-ins with something to show. The others are plumbing every chat needs,
 * so they stay out of sight unless they fail to load.
 */
const BUILTINS = new Map<string, Presentation>([
  [
    "web-search",
    { name: "Web search", description: "Search the web and read pages", icon: "globe" },
  ],
  ["mcp", { name: "MCP servers", description: "Tools from servers in nyte.json", icon: "mcp" }],
  [
    "codemode",
    {
      name: "Code mode",
      description: "Run scripts that batch and chain tool calls",
      icon: "brackets",
    },
  ],
  [
    "fast-mode",
    { name: "Fast mode", description: "Priority processing at a premium", icon: "speed-low" },
  ],
  [
    "rename",
    { name: "Chat titles", description: "Names a chat from its first message", icon: "writing" },
  ],
  [
    "openai/compaction",
    {
      name: "Compaction",
      description: "Compacts long chats with OpenAI's native compaction",
      icon: "cube",
    },
  ],
]);

const PLUGIN_SECTION = "plugin:";

interface PluginView extends Partial<Presentation> {
  readonly info: PluginInfo;
  readonly name: string;
  readonly icon: IconName;
  readonly off: boolean;
}

function isToggle(setting: SettingInfo): boolean {
  return (
    setting.choices.length === 2 &&
    setting.choices.every((choice) => choice.id === "on" || choice.id === "off")
  );
}

function present(plugin: PluginInfo, settings: readonly SettingInfo[]): PluginView | undefined {
  const builtin = BUILTINS.get(plugin.id);

  if (builtin === undefined && plugin.source === "builtin" && plugin.status === "active")
    return undefined;

  const toggles = settings.filter((setting) => setting.owner === plugin.id && isToggle(setting));
  const off = toggles.length > 0 && toggles.every((setting) => setting.current === "off");

  return { name: plugin.id, icon: "box-3d", ...builtin, info: plugin, off };
}

function matches(query: string, ...values: readonly (string | undefined)[]): boolean {
  const needle = query.trim().toLocaleLowerCase();

  return (
    needle === "" || values.some((value) => value?.toLocaleLowerCase().includes(needle) === true)
  );
}

function parentPath(path: string): string {
  return path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));
}

/** Skills grouped by the folder their own folders sit in. */
function skillFolders(skills: readonly Skill[]): readonly (readonly [string, readonly Skill[]])[] {
  const folders = new Map<string, Skill[]>();

  for (const skill of skills) {
    const folder = parentPath(parentPath(skill.filePath));
    folders.set(folder, [...(folders.get(folder) ?? []), skill]);
  }

  return [...folders];
}

function PluginStatus({ plugin }: { readonly plugin: PluginView }): ReactElement | null {
  if (plugin.info.status === "failed")
    return <ConnectionStatus tone="err">Couldn&rsquo;t load</ConnectionStatus>;

  if (plugin.off) return <ConnectionStatus tone="off">Off</ConnectionStatus>;

  return null;
}

function Section({
  title,
  description,
  action,
  children,
}: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section {...props(settingsPatterns.section)}>
      <header {...props(styles.sectionHeader)}>
        <div {...props(styles.sectionCopy)}>
          <h2 {...props(settingsPatterns.sectionTitle)}>{title}</h2>
          {description !== undefined && (
            <p {...props(settingsPatterns.sectionDescription)}>{description}</p>
          )}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function PluginGrid({
  plugins,
  onOpen,
}: {
  readonly plugins: readonly PluginView[];
  readonly onOpen: (plugin: PluginView) => void;
}): ReactElement {
  return (
    <div {...props(styles.grid)}>
      {plugins.map((plugin) => (
        <Row key={plugin.info.id} variant="nav" xstyle={styles.card} onClick={() => onOpen(plugin)}>
          <span {...props(styles.tile)}>
            <Icon name={plugin.icon} size={16} />
          </span>
          <span {...props(styles.cardCopy)}>
            <span {...props(settingsPatterns.rowTitle, styles.ellipsis)}>{plugin.name}</span>
            <span {...props(styles.cardMeta)}>
              <PluginStatus plugin={plugin} />
              {plugin.info.source === "project" && <span {...props(styles.tag)}>Project</span>}
            </span>
          </span>
        </Row>
      ))}
    </div>
  );
}

function OpenPluginsFolder(): ReactElement | null {
  const open = nyte.host.openPluginsFolder;

  if (open === undefined) return null;

  return (
    <Button icon="folder-open" onClick={() => void open()}>
      Open Plugins Folder
    </Button>
  );
}

function Overview({
  inventory,
  onOpen,
}: {
  readonly inventory: CustomizeInventory;
  readonly onOpen: (plugin: PluginView) => void;
}): ReactElement {
  const [query, setQuery] = useState("");
  const host = useHostState();
  const reveal = nyte.host.revealPath;

  const plugins = inventory.plugins
    .flatMap((plugin) => present(plugin, inventory.settings) ?? [])
    .filter((plugin) => matches(query, plugin.name, plugin.description, plugin.info.id));

  const yours = plugins.filter((plugin) => plugin.info.source !== "builtin");
  const builtIn = plugins.filter((plugin) => plugin.info.source === "builtin");
  const noneOfYours = inventory.plugins.every((plugin) => plugin.source === "builtin");

  const folders = skillFolders(
    inventory.skills.filter((skill) => matches(query, skill.name, skill.description)),
  );

  const searching = query.trim() !== "";

  return (
    <>
      <InputGroup>
        <Icon name="search" size={14} />
        <Input
          type="search"
          aria-label="Search"
          placeholder="Search"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onValueChange={setQuery}
        />
      </InputGroup>

      <Section title="Plugins" action={noneOfYours ? undefined : <OpenPluginsFolder />}>
        {yours.length > 0 && <PluginGrid plugins={yours} onOpen={onOpen} />}
        {noneOfYours && !searching && nyte.host.openPluginsFolder !== undefined && (
          <div {...props(styles.empty)}>
            <span {...props(styles.emptyCopy, settingsPatterns.rowTitle)}>Add your own plugin</span>
            <OpenPluginsFolder />
          </div>
        )}
        {builtIn.length > 0 && (
          <>
            <div {...props(styles.subheading)}>Built in</div>
            <PluginGrid plugins={builtIn} onOpen={onOpen} />
          </>
        )}
      </Section>

      {folders.length > 0 && (
        <Section title="Skills">
          {folders.map(([folder, skills]) => (
            <ConnectionList key={folder}>
              <div {...props(styles.folderHeading)}>
                <Icon name="folder" size={14} />
                <span title={folder} {...props(styles.folderPath, styles.ellipsis)}>
                  {folder}
                </span>
                {reveal !== undefined && (
                  <Button
                    size="sm"
                    iconOnly
                    icon="folder-open"
                    aria-label={revealLabel(host.data?.platform)}
                    onClick={() => void reveal({ path: folder })}
                  />
                )}
              </div>
              {skills.map((skill) => (
                <ConnectionRow
                  key={skill.filePath}
                  glyph={<Icon name="skills" size={16} />}
                  title={skill.name}
                  detail={skill.description}
                />
              ))}
            </ConnectionList>
          ))}
        </Section>
      )}

      {searching && plugins.length + folders.length === 0 && (
        <p {...props(styles.note)}>Nothing matches &ldquo;{query.trim()}&rdquo;</p>
      )}
    </>
  );
}

function PluginSetting({
  setting,
  disabled,
  onApply,
}: {
  readonly setting: SettingInfo;
  readonly disabled: boolean;
  readonly onApply: (choiceId: string) => void;
}): ReactElement {
  if (isToggle(setting))
    return (
      <SettingsSwitchRow
        title={setting.label}
        disabled={disabled}
        checked={setting.current === "on"}
        onCheckedChange={(checked) => onApply(checked ? "on" : "off")}
      />
    );

  return (
    <SettingsRow title={setting.label}>
      <Select
        items={setting.choices.map((choice) => ({ value: choice.id, label: choice.label }))}
        disabled={disabled}
        value={setting.current}
        onValueChange={(choiceId) => {
          if (choiceId !== null) onApply(choiceId);
        }}
      >
        <SelectTrigger aria-label={setting.label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {setting.choices.map((choice) => (
            <SelectItem key={choice.id} value={choice.id} label={choice.label}>
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsRow>
  );
}

function Detail({
  plugin,
  inventory,
  sessionId,
  onBack,
}: {
  readonly plugin: PluginView;
  readonly inventory: CustomizeInventory;
  readonly sessionId: SessionId | undefined;
  readonly onBack: () => void;
}): ReactElement {
  const apply = useApplyPluginSetting(sessionId);
  const host = useHostState();
  const reveal = nyte.host.revealPath;
  const { info } = plugin;
  const settings = inventory.settings.filter((setting) => setting.owner === info.id);
  const commands = inventory.commands.filter((command) => command.owner === info.id);
  const builtin = info.source === "builtin";
  const failure = info.status === "failed" ? info.error : undefined;
  const path = info.path;

  return (
    <>
      <Button variant="ghost" icon="arrow-left" xstyle={styles.back} onClick={onBack}>
        Customize
      </Button>

      <header {...props(styles.detailHeader)}>
        <span {...props(styles.tile)}>
          <Icon name={plugin.icon} size={20} />
        </span>
        <div {...props(styles.sectionCopy)}>
          <h1 {...props(settingsPatterns.pageTitle)}>{plugin.name}</h1>
          {plugin.description !== undefined && (
            <p {...props(settingsPatterns.sectionDescription)}>{plugin.description}</p>
          )}
        </div>
      </header>

      {failure !== undefined && (
        <div role="alert" {...props(intent.danger, styles.failure)}>
          <div {...props(styles.failureHead)}>
            <span {...props(styles.failureIcon)}>
              <Icon name="circle-x" size={16} />
            </span>
            <span {...props(styles.cardCopy)}>
              <span {...props(settingsPatterns.rowTitle)}>Couldn&rsquo;t load this plugin</span>
              <span {...props(styles.muted)}>
                Nyte tries again when a file in its folder changes.
              </span>
            </span>
          </div>
          <pre {...props(styles.trace)}>{failure}</pre>
          <div {...props(styles.actions)}>
            <Button icon="copy" onClick={() => void navigator.clipboard.writeText(failure)}>
              Copy Error
            </Button>
          </div>
        </div>
      )}

      {!builtin && (
        <div {...props(styles.facts)}>
          <span {...props(styles.fact)}>
            <span {...props(styles.factLabel)}>Version</span>
            <span {...props(settingsPatterns.rowTitle)}>{info.version}</span>
          </span>
          {path !== undefined && (
            <span {...props(styles.fact, styles.factGrow)}>
              <span {...props(styles.factLabel)}>Location</span>
              <span title={path} {...props(styles.code, styles.ellipsis)}>
                {path}
              </span>
            </span>
          )}
          {path !== undefined && reveal !== undefined && (
            <Button icon="folder-open" onClick={() => void reveal({ path })}>
              {revealLabel(host.data?.platform)}
            </Button>
          )}
        </div>
      )}

      {settings.length > 0 && (
        <Section
          title="Settings"
          description={
            sessionId === undefined
              ? "Defaults for new chats. Open a chat to change them."
              : "For this chat"
          }
        >
          <div {...props(settingsPatterns.group)}>
            {settings.map((setting) => (
              <PluginSetting
                key={setting.id}
                setting={setting}
                disabled={sessionId === undefined || apply.isPending}
                onApply={(choiceId) => apply.mutate({ id: setting.id, choiceId })}
              />
            ))}
          </div>
        </Section>
      )}

      {commands.length > 0 && (
        <Section title="Commands">
          <ConnectionList>
            {commands.map((command) => (
              <div key={command.name} {...props(styles.contribution)}>
                <span {...props(styles.contributionName)}>/{command.name}</span>
                <span {...props(styles.muted)}>{command.description}</span>
              </div>
            ))}
          </ConnectionList>
        </Section>
      )}
    </>
  );
}

function InventoryLoading(): ReactElement {
  return (
    <div aria-busy="true" aria-label="Loading" {...props(settingsPatterns.group)}>
      {["first", "second", "third"].map((key) => (
        <div key={key} {...props(settingsPatterns.row)}>
          <div {...props(styles.loadingLine)} />
        </div>
      ))}
    </div>
  );
}

export function CustomizeSurface({
  sessionId,
}: {
  sessionId: SessionId | undefined;
}): ReactElement {
  const section = useSearch({ from: "__root__", select: (search) => search.customize });
  const navigate = useNavigate();
  const projectSettings = usePluginSettingsProjection(sessionId);

  const inventory = useQuery<CustomizeInventory>({
    queryKey: sessionId === undefined ? keys.pluginCatalog : ["customize", sessionId],
    select: (inventory) => ({ ...inventory, settings: projectSettings(inventory.settings) }),
    queryFn: async () => {
      if (sessionId === undefined) return nyte.plugins.catalog();

      const [plugins, settings, skills, commands] = await Promise.all([
        nyte.plugins.list({ sessionId }),
        nyte.plugins.settings.list({ sessionId }),
        nyte.plugins.resources.list({ sessionId }),
        nyte.plugins.commands.list({ sessionId }),
      ]);

      return { plugins, settings, skills, commands };
    },
  });

  const show = (next: string): void =>
    void navigate({ to: ".", search: (previous) => ({ ...previous, customize: next }) });

  const openId = section?.startsWith(PLUGIN_SECTION)
    ? section.slice(PLUGIN_SECTION.length)
    : undefined;

  const openPlugin = inventory.data?.plugins.find((plugin) => plugin.id === openId);

  const opened =
    openPlugin === undefined || inventory.data === undefined
      ? undefined
      : present(openPlugin, inventory.data.settings);

  return (
    <div data-nyte-customize-surface {...props(styles.surface)}>
      <div {...props(styles.root)}>
        {opened !== undefined && inventory.data !== undefined ? (
          <Detail
            key={opened.info.id}
            plugin={opened}
            inventory={inventory.data}
            sessionId={sessionId}
            onBack={() => show("plugins")}
          />
        ) : (
          <>
            <h1 {...props(settingsPatterns.pageTitle, styles.title)}>Customize</h1>
            {inventory.isPending && <InventoryLoading />}
            {inventory.isError && (
              <p role="alert" title={inventory.error.message} {...props(styles.note)}>
                Couldn&rsquo;t load plugins and skills. Try again.
              </p>
            )}
            {inventory.data !== undefined && (
              <Overview
                inventory={inventory.data}
                onOpen={(plugin) => show(`${PLUGIN_SECTION}${plugin.info.id}`)}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
