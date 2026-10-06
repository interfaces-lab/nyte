import { intent } from "@nyte-ai/ui/surface-theme";
import { props } from "@stylexjs/stylex";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import type { PluginInfo, SessionId, SettingInfo } from "@nyte-ai/protocol";
import { Button } from "@nyte-ai/ui/button";
import { Icon, type IconName } from "@nyte-ai/ui/icon";
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
import { SettingsRow, SettingsSwitchRow } from "../settings/rows.tsx";
import { settingsStyles as page } from "../settings/settings.stylex.ts";
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

function parentPath(path: string): string {
  return path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));
}

function Section({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section {...props(settingsPatterns.section)}>
      <div {...props(settingsPatterns.sectionHeader)}>
        <h2 {...props(settingsPatterns.sectionTitle)}>{title}</h2>
        {description !== undefined && (
          <p {...props(settingsPatterns.sectionDescription)}>{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

/** A plugin earns a page only when the page would have something on it. */
function hasPage(plugin: PluginView, inventory: CustomizeInventory): boolean {
  const owns = (owner: string): boolean => owner === plugin.info.id;

  return (
    plugin.info.status === "failed" ||
    plugin.info.path !== undefined ||
    inventory.settings.some((setting) => owns(setting.owner)) ||
    inventory.commands.some((command) => owns(command.owner))
  );
}

function PluginRow({
  plugin,
  inventory,
  onOpen,
}: {
  readonly plugin: PluginView;
  readonly inventory: CustomizeInventory;
  readonly onOpen: (plugin: PluginView) => void;
}): ReactElement {
  const detail =
    plugin.info.status === "failed" ? (
      <ConnectionStatus tone="err">Couldn&rsquo;t load</ConnectionStatus>
    ) : plugin.off ? (
      <ConnectionStatus tone="off">Off</ConnectionStatus>
    ) : (
      plugin.description
    );

  return (
    <ConnectionRow
      glyph={<Icon name={plugin.icon} size={16} />}
      title={plugin.name}
      detail={detail}
      control={
        hasPage(plugin, inventory) ? (
          <Button variant="outline" onClick={() => onOpen(plugin)}>
            Manage
          </Button>
        ) : undefined
      }
    />
  );
}

function Overview({
  inventory,
  onOpen,
}: {
  readonly inventory: CustomizeInventory;
  readonly onOpen: (plugin: PluginView) => void;
}): ReactElement {
  const host = useHostState();
  const reveal = nyte.host.revealPath;
  const openPluginsFolder = nyte.host.openPluginsFolder;
  const plugins = inventory.plugins.flatMap((plugin) => present(plugin, inventory.settings) ?? []);
  const yours = plugins.filter((plugin) => plugin.info.source !== "builtin");
  const builtIn = plugins.filter((plugin) => plugin.info.source === "builtin");

  return (
    <>
      {(yours.length > 0 || openPluginsFolder !== undefined) && (
        <Section title="Your plugins">
          <ConnectionList>
            {yours.map((plugin) => (
              <PluginRow
                key={plugin.info.id}
                plugin={plugin}
                inventory={inventory}
                onOpen={onOpen}
              />
            ))}
            {openPluginsFolder !== undefined && (
              <ConnectionRow
                glyph={<Icon name="folder-add" size={16} />}
                title="Add your own plugin"
                control={
                  <Button
                    variant="outline"
                    icon="folder-open"
                    onClick={() => void openPluginsFolder()}
                  >
                    Open Plugins Folder
                  </Button>
                }
              />
            )}
          </ConnectionList>
        </Section>
      )}

      {builtIn.length > 0 && (
        <Section title="Built in">
          <ConnectionList>
            {builtIn.map((plugin) => (
              <PluginRow
                key={plugin.info.id}
                plugin={plugin}
                inventory={inventory}
                onOpen={onOpen}
              />
            ))}
          </ConnectionList>
        </Section>
      )}

      {inventory.skills.length > 0 && (
        <Section title="Skills">
          <ConnectionList>
            {inventory.skills.map((skill) => (
              <ConnectionRow
                key={skill.filePath}
                glyph={<Icon name="skills" size={16} />}
                title={skill.name}
                detail={skill.description}
                control={
                  reveal === undefined ? undefined : (
                    <Button
                      iconOnly
                      icon="folder-open"
                      aria-label={revealLabel(host.data?.platform)}
                      onClick={() => void reveal({ path: parentPath(skill.filePath) })}
                    />
                  )
                }
              />
            ))}
          </ConnectionList>
        </Section>
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
  const failure = info.status === "failed" ? info.error : undefined;
  const path = info.path;

  return (
    <>
      <Button variant="ghost" icon="arrow-left" xstyle={styles.back} onClick={onBack}>
        Customize
      </Button>

      <div {...props(page.titleRow, styles.titleCopy)}>
        <h1 {...props(settingsPatterns.pageTitle)}>{plugin.name}</h1>
        {plugin.description !== undefined && (
          <p {...props(settingsPatterns.sectionDescription)}>{plugin.description}</p>
        )}
      </div>

      {failure !== undefined && (
        <ConnectionList>
          <ConnectionRow
            glyph={
              <span {...props(intent.danger, styles.failed)}>
                <Icon name="circle-x" size={16} />
              </span>
            }
            title="Couldn’t load this plugin"
            detail="Nyte tries again when a file in its folder changes."
            control={
              <Button
                variant="outline"
                icon="copy"
                onClick={() => void navigator.clipboard.writeText(failure)}
              >
                Copy Error
              </Button>
            }
            expansion={<pre {...props(styles.trace)}>{failure}</pre>}
          />
        </ConnectionList>
      )}

      {info.source !== "builtin" && (
        <div {...props(settingsPatterns.group)}>
          <SettingsRow title="Version">
            <span {...props(styles.value)}>{info.version}</span>
          </SettingsRow>
          {path !== undefined && (
            <SettingsRow title="Location" description={path} controlWidth="wide">
              {reveal !== undefined && (
                <Button variant="outline" icon="folder-open" onClick={() => void reveal({ path })}>
                  {revealLabel(host.data?.platform)}
                </Button>
              )}
            </SettingsRow>
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
              <ConnectionRow
                key={command.name}
                glyph={<Icon name="command" size={16} />}
                title={`/${command.name}`}
                detail={command.description}
              />
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
    <div data-nyte-customize-surface {...props(page.content)}>
      <div {...props(page.contentInner)}>
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
            {inventory.isPending && <InventoryLoading />}
            {inventory.isError && (
              <p role="alert" {...props(settingsPatterns.sectionDescription)}>
                Couldn&rsquo;t load plugins and skills: {inventory.error.message}
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
