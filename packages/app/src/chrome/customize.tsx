import { intent } from "@nyte-ai/ui/surface-theme";
import { props } from "@stylexjs/stylex";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { ReactElement, ReactNode } from "react";
import type { CommandInfo, HostView, Json, SessionId, SettingInfo, SkillInfo } from "@nyte-ai/sdk";
import { Button } from "@nyte-ai/ui/button";
import { Icon, type IconName } from "@nyte-ai/ui/icon";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nyte-ai/ui/select";
import { revealLabel } from "../components/context-menu.ts";
import { nyte } from "../nyte.ts";
import {
  useApplyPluginSetting,
  useHostState,
  usePluginSettingsProjection,
  useSessionView,
} from "../queries.ts";
import { hostWatch, useWatch } from "../sdk.tsx";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { ConnectionList, ConnectionRow, ConnectionStatus } from "./connection-list.tsx";
import { SettingsRow, SettingsSwitchRow } from "../settings/rows.tsx";
import { settingsStyles as page } from "../settings/settings.stylex.ts";
import { customizeStyles as styles } from "./customize.stylex.ts";
import { text } from "@nyte-ai/ui/styles/text.stylex";

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
  ["mcp", { name: "MCP servers", description: "Tools from servers in mcp.json", icon: "mcp" }],
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
    "openai/compaction",
    {
      name: "Compaction",
      description: "Compacts long chats with OpenAI's native compaction",
      icon: "cube",
    },
  ],
]);

const PLUGIN_SECTION = "plugin:";

type PluginInfo = HostView["plugins"][number];

interface CustomizeInventory {
  readonly plugins: readonly PluginInfo[];
  readonly settings: readonly SettingInfo[];
  readonly skills: readonly SkillInfo[];
  readonly commands: readonly CommandInfo[];
}

interface PluginView extends Partial<Presentation> {
  readonly info: PluginInfo;
  readonly name: string;
  readonly icon: IconName;
  readonly off: boolean;
}

function loadFailure(plugin: PluginInfo): string | undefined {
  const errors = plugin.issues.filter((issue) => issue.severity === "error");

  return errors.length === 0 ? undefined : errors.map((issue) => issue.message).join("\n");
}

function choiceKey(value: Json): string {
  return JSON.stringify(value);
}

function present(plugin: PluginInfo, settings: readonly SettingInfo[]): PluginView | undefined {
  const builtin = BUILTINS.get(plugin.id);

  if (builtin === undefined && plugin.source === "builtin" && loadFailure(plugin) === undefined)
    return undefined;

  const toggles = settings.filter(
    (setting) => setting.owner === plugin.id && typeof setting.value === "boolean",
  );
  const off = toggles.length > 0 && toggles.every((setting) => setting.value === false);

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
    loadFailure(plugin.info) !== undefined ||
    plugin.info.path !== null ||
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
    loadFailure(plugin.info) !== undefined ? (
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
                key={skill.location}
                glyph={<Icon name="skills" size={16} />}
                title={skill.name}
                detail={skill.description}
                control={
                  reveal === undefined ? undefined : (
                    <Button
                      iconOnly
                      icon="folder-open"
                      aria-label={revealLabel(host.data?.platform)}
                      onClick={() => void reveal({ path: parentPath(skill.location) })}
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
  readonly onApply: (value: Json) => void;
}): ReactElement {
  if (typeof setting.value === "boolean")
    return (
      <SettingsSwitchRow
        title={setting.label}
        disabled={disabled}
        checked={setting.value === true}
        onCheckedChange={(checked) => onApply(checked)}
      />
    );

  const choices = setting.choices ?? [];

  return (
    <SettingsRow title={setting.label}>
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
  const failure = loadFailure(info);
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
            expansion={<pre {...props(text.sm, styles.trace)}>{failure}</pre>}
          />
        </ConnectionList>
      )}

      {info.source !== "builtin" && (
        <div {...props(settingsPatterns.group)}>
          {path !== null && (
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
                disabled={
                  (sessionId === undefined && setting.scope === "session") || apply.isPending
                }
                onApply={(value) => apply.mutate({ id: setting.id, value })}
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

  const hostView = useWatch(hostWatch("host")).value;
  const view = useSessionView(sessionId);

  const inventory = {
    data:
      hostView === undefined
        ? undefined
        : ({
            plugins: hostView.plugins,
            settings: projectSettings(view?.catalog.settings ?? hostView.settings),
            skills: view?.catalog.skills ?? [],
            commands: view?.catalog.commands ?? [],
          } satisfies CustomizeInventory),
    isPending: hostView === undefined,
  };

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
