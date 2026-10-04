import {
  ConnectionList,
  ConnectionRow,
  ConnectionStatus,
} from "@nyte-ai/app/chrome/connection-list.tsx";
import { settingsPatterns } from "@nyte-ai/app/theme/settings-patterns.stylex.ts";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Input, InputGroup } from "@nyte-ai/ui/input";
import { Switch } from "@nyte-ai/ui/switch";
import { props } from "@stylexjs/stylex";
import { useState, type ReactElement, type ReactNode } from "react";
import { reveal } from "./actions";
import { customizeStyles as styles } from "./customize.stylex";
import { FOLDERS, type Inventory, type LabPlugin } from "./fixtures";

function matches(query: string, ...values: readonly string[]): boolean {
  const needle = query.trim().toLocaleLowerCase();

  return needle === "" || values.some((value) => value.toLocaleLowerCase().includes(needle));
}

export function Section({
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

/** Only states that differ from the norm; a plugin that simply works says nothing. */
export function PluginStatus({ plugin }: { readonly plugin: LabPlugin }): ReactElement | null {
  if (plugin.standing.kind === "failed")
    return <ConnectionStatus tone="err">Couldn&rsquo;t load</ConnectionStatus>;

  const toggle = plugin.settings.find((setting) => setting.choices.length === 2);

  if (toggle?.current === "off") return <ConnectionStatus tone="off">Off</ConnectionStatus>;

  return null;
}

function PluginSummary({
  plugin,
  describe,
}: {
  readonly plugin: LabPlugin;
  readonly describe: boolean;
}): ReactElement {
  return (
    <span {...props(styles.cardCopy)}>
      <span {...props(styles.cardTitle)}>{plugin.name}</span>
      <span {...props(styles.cardMeta)}>
        <PluginStatus plugin={plugin} />
        {plugin.source === "project" && <span {...props(styles.tag)}>Project</span>}
        {describe && plugin.standing.kind === "active" && (
          <span {...props(styles.listDescription)}>{plugin.description}</span>
        )}
      </span>
    </span>
  );
}

function PluginCard({
  plugin,
  onOpen,
}: {
  readonly plugin: LabPlugin;
  readonly onOpen: () => void;
}): ReactElement {
  return (
    <button type="button" onClick={onOpen} {...props(styles.card)}>
      <span {...props(styles.tile)}>
        <Icon name={plugin.icon} size={16} />
      </span>
      <PluginSummary plugin={plugin} describe={false} />
    </button>
  );
}

function PluginList({
  plugins,
  onOpen,
}: {
  readonly plugins: readonly LabPlugin[];
  readonly onOpen: (plugin: LabPlugin) => void;
}): ReactElement {
  return (
    <ConnectionList>
      {plugins.map((plugin) => (
        <button
          key={plugin.id}
          type="button"
          onClick={() => onOpen(plugin)}
          {...props(styles.listRow)}
        >
          <span {...props(styles.tile)}>
            <Icon name={plugin.icon} size={16} />
          </span>
          <PluginSummary plugin={plugin} describe />
          <span {...props(styles.chevron)}>
            <Icon name="chevron-right" size={14} />
          </span>
        </button>
      ))}
    </ConnectionList>
  );
}

function Plugins({
  layout,
  plugins,
  onOpen,
}: {
  readonly layout: Layout;
  readonly plugins: readonly LabPlugin[];
  readonly onOpen: (plugin: LabPlugin) => void;
}): ReactElement {
  if (layout === "list") return <PluginList plugins={plugins} onOpen={onOpen} />;

  return (
    <div {...props(styles.grid)}>
      {plugins.map((plugin) => (
        <PluginCard key={plugin.id} plugin={plugin} onOpen={() => onOpen(plugin)} />
      ))}
    </div>
  );
}

/** An empty section's card owns the path and the action; the header then carries neither. */
function Empty({
  title,
  children,
  action,
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly action: ReactNode;
}): ReactElement {
  return (
    <div {...props(styles.empty)}>
      <span {...props(styles.emptyCopy)}>
        <span {...props(styles.emptyTitle)}>{title}</span>
        <span {...props(styles.muted)}>{children}</span>
      </span>
      {action}
    </div>
  );
}

function Path({ children }: { readonly children: string }): ReactElement {
  return <code {...props(styles.code)}>{children}</code>;
}

export type Layout = "cards" | "list";

export function Overview({
  layout,
  inventory,
  onOpen,
}: {
  readonly layout: Layout;
  readonly inventory: Inventory;
  readonly onOpen: (plugin: LabPlugin) => void;
}): ReactElement {
  const [query, setQuery] = useState("");
  const [serversOn, setServersOn] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(inventory.servers.map((server) => [server.name, server.on])),
  );

  const plugins = inventory.plugins.filter((plugin) =>
    matches(query, plugin.name, plugin.description, plugin.id),
  );
  const yours = plugins.filter((plugin) => plugin.source !== "builtin");
  const builtIn = plugins.filter((plugin) => plugin.source === "builtin");
  const servers = inventory.servers.filter((server) => matches(query, server.name, server.command));
  const folders = inventory.skills
    .map((folder) => ({
      ...folder,
      skills: folder.skills.filter((skill) => matches(query, skill.name, skill.description)),
    }))
    .filter((folder) => folder.skills.length > 0);
  const searching = query.trim() !== "";
  const noPlugins = inventory.plugins.every((plugin) => plugin.source === "builtin");
  const noServers = inventory.servers.length === 0;
  const noSkills = inventory.skills.length === 0;

  return (
    <>
      <h1 {...props(settingsPatterns.pageTitle)}>Customize</h1>

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

      <Section
        title="Plugins"
        description={
          noPlugins ? undefined : (
            <>
              From <Path>{FOLDERS.userPlugins}</Path> and this project&rsquo;s{" "}
              <Path>{FOLDERS.projectPlugins}</Path>
            </>
          )
        }
        action={
          noPlugins ? undefined : (
            <Button icon="folder-open" onClick={() => reveal(FOLDERS.userPlugins, "open")}>
              Open folder
            </Button>
          )
        }
      >
        {yours.length > 0 && <Plugins layout={layout} plugins={yours} onOpen={onOpen} />}
        {noPlugins && !searching && (
          <Empty
            title="Add your own plugin"
            action={
              <Button icon="folder-open" onClick={() => reveal(FOLDERS.userPlugins, "open")}>
                Open folder
              </Button>
            }
          >
            Put a plugin folder in <Path>{FOLDERS.userPlugins}</Path>
          </Empty>
        )}

        {builtIn.length > 0 && (
          <>
            <div {...props(styles.subheading)}>Built in</div>
            <Plugins layout={layout} plugins={builtIn} onOpen={onOpen} />
          </>
        )}
      </Section>

      <Section
        title="MCP servers"
        action={
          noServers ? undefined : (
            <Button onClick={() => reveal(FOLDERS.manifest, "edit")}>Edit nyte.json</Button>
          )
        }
      >
        {servers.length > 0 && (
          <ConnectionList>
            {servers.map((server) => {
              const on = serversOn.get(server.name) ?? server.on;

              return (
                <ConnectionRow
                  key={server.name}
                  glyph={<Icon name="mcp" size={16} />}
                  title={server.name}
                  detail={<ServerDetail on={on} tools={server.tools} error={server.error} />}
                  control={
                    <Switch
                      label={`Use ${server.name}`}
                      checked={on}
                      onCheckedChange={(checked) =>
                        setServersOn((current) => new Map(current).set(server.name, checked))
                      }
                    />
                  }
                />
              );
            })}
          </ConnectionList>
        )}
        {noServers && !searching && (
          <Empty
            title="No servers yet"
            action={
              <Button icon="plus" onClick={() => reveal(FOLDERS.manifest, "edit")}>
                Add server
              </Button>
            }
          >
            Add one under <Path>mcp</Path> in <Path>{FOLDERS.manifest}</Path>
          </Empty>
        )}
      </Section>

      <Section title="Skills">
        {folders.map((folder) => (
          <ConnectionList key={folder.path}>
            <div {...props(styles.folderHeading)}>
              <Icon name="folder" size={14} />
              <span {...props(styles.folderPath)}>{folder.path}</span>
              <Button
                size="sm"
                iconOnly
                icon="folder-open"
                aria-label={`Open ${folder.path}`}
                onClick={() => reveal(folder.path, "open")}
              />
            </div>
            {folder.skills.map((skill) => (
              <ConnectionRow
                key={skill.name}
                glyph={<Icon name="skills" size={16} />}
                title={skill.name}
                detail={skill.description}
              />
            ))}
          </ConnectionList>
        ))}
        {noSkills && !searching && (
          <Empty
            title="No skills yet"
            action={
              <Button icon="folder-open" onClick={() => reveal(FOLDERS.userSkills, "open")}>
                Open folder
              </Button>
            }
          >
            Add a folder with a <Path>SKILL.md</Path> to <Path>{FOLDERS.userSkills}</Path>
          </Empty>
        )}
      </Section>

      {searching && yours.length + builtIn.length + servers.length + folders.length === 0 && (
        <p {...props(styles.muted)}>Nothing matches &ldquo;{query.trim()}&rdquo;</p>
      )}
    </>
  );
}

/** The switch already says on or off; the line under the name says what the switch can't. */
function ServerDetail({
  on,
  tools,
  error,
}: {
  readonly on: boolean;
  readonly tools: number;
  readonly error: string | undefined;
}): ReactNode {
  if (!on) return undefined;
  if (error !== undefined) return <ConnectionStatus tone="err">{error}</ConnectionStatus>;

  return `${tools} tools`;
}
