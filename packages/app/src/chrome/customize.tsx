import { intent } from "@nyte-ai/ui/surface-theme";
import { props } from "@stylexjs/stylex";
import { Tabs } from "@nyte-ai/ui/tabs";
import { Row } from "@nyte-ai/ui/row";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import type { PluginInfo, SessionId, SettingInfo } from "@nyte-ai/protocol";
import { Icon } from "@nyte-ai/ui/icon";
import { Input, InputGroup } from "@nyte-ai/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nyte-ai/ui/select";
import { useChromeTab } from "./use-chrome-tab.ts";
import { isOption } from "./sidebar-view.ts";
import { nyte } from "../nyte.ts";
import {
  keys,
  useApplyPluginSetting,
  usePluginSettingsProjection,
  type CustomizeInventory,
} from "../queries.ts";
import { customizeStyles as styles } from "./customize.stylex.ts";

type CustomizeTab = "plugins" | "skills" | "settings";

const CUSTOMIZE_TABS = [
  ["plugins", "Plugins & MCPs"],
  ["skills", "Skills"],
  ["settings", "Settings"],
] as const satisfies readonly (readonly [CustomizeTab, string])[];

const CUSTOMIZE_TAB_IDS = ["plugins", "skills", "settings"] as const;

const EMPTY_INVENTORY: CustomizeInventory = { plugins: [], settings: [], skills: [] };

function matchesQuery(query: string, ...values: readonly string[]): boolean {
  const needle = query.trim().toLocaleLowerCase();

  return needle === "" || values.some((value) => value.toLocaleLowerCase().includes(needle));
}

function filterInventory(inventory: CustomizeInventory, query: string): CustomizeInventory {
  return {
    plugins: inventory.plugins.filter((plugin) =>
      matchesQuery(
        query,
        plugin.id,
        plugin.source,
        plugin.version,
        plugin.status,
        plugin.status === "failed" ? plugin.error : "",
      ),
    ),
    skills: inventory.skills.filter((skill) =>
      matchesQuery(query, skill.name, skill.description, skill.filePath),
    ),
    settings: inventory.settings.filter((setting) =>
      matchesQuery(
        query,
        setting.label,
        setting.owner,
        ...setting.choices.flatMap((choice) => [
          choice.label,
          choice.description ?? "",
          choice.status ?? "",
        ]),
      ),
    ),
  };
}

function tabCount(inventory: CustomizeInventory, tab: CustomizeTab): number {
  switch (tab) {
    case "plugins":
      return inventory.plugins.length;
    case "skills":
      return inventory.skills.length;
    case "settings":
      return inventory.settings.length;
    default: {
      const _exhaustive: never = tab;

      return _exhaustive;
    }
  }
}

function pluginDetail(plugin: PluginInfo): string {
  if (plugin.status === "failed") return `Couldn't load this plugin. ${plugin.error}`;

  return `${plugin.source} · ${plugin.version}`;
}

function InventoryLoading(): ReactElement {
  return (
    <div aria-busy="true" aria-label="Loading inventory" {...props(styles.list)}>
      {(["first", "second", "third"] as const).map((key) => (
        <div key={key} {...props(styles.quiet)}>
          <div {...props(styles.loadingLine)} />
        </div>
      ))}
    </div>
  );
}

export function PluginSettings({
  sessionId,
  settings,
}: {
  sessionId: SessionId | undefined;
  settings: readonly SettingInfo[];
}): ReactElement | null {
  const apply = useApplyPluginSetting(sessionId);

  if (settings.length === 0) return null;

  return (
    <>
      <div {...props(styles.list)}>
        {settings.map((setting) => {
          const choice = setting.choices.find((choice) => choice.id === setting.current);
          const detail = choice?.status ?? choice?.description;

          return (
            <Row key={setting.id} xstyle={styles.row}>
              <Row.Body>
                <Row.Label xstyle={styles.rowTitle}>{setting.label}</Row.Label>
                <Row.Description>{setting.owner}</Row.Description>
                {detail !== undefined && <Row.Description title={detail}>{detail}</Row.Description>}
              </Row.Body>
              <Row.Actions>
                <Select
                  items={setting.choices.map((choice) => ({
                    value: choice.id,
                    label: choice.label,
                  }))}
                  disabled={sessionId === undefined || apply.isPending}
                  value={setting.current}
                  onValueChange={(choiceId) => {
                    if (choiceId !== null && sessionId !== undefined)
                      apply.mutate({ id: setting.id, choiceId });
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
              </Row.Actions>
            </Row>
          );
        })}
      </div>
      {sessionId === undefined && (
        <div {...props(styles.settingsNote)}>
          Defaults shown. Open a chat to change its settings.
        </div>
      )}
      {apply.isError && (
        <div role="alert" title={apply.error.message} {...props(intent.danger, styles.error)}>
          Couldn&rsquo;t change that setting. Try again.
        </div>
      )}
    </>
  );
}

function Inventory({
  sessionId,
  inventory,
  tab,
}: {
  sessionId: SessionId | undefined;
  inventory: CustomizeInventory;
  tab: CustomizeTab;
}): ReactElement {
  switch (tab) {
    case "plugins":
      return (
        <div {...props(styles.list)}>
          {inventory.plugins.map((plugin) => (
            <Row key={plugin.id} xstyle={styles.row}>
              <Row.Leading xstyle={styles.rowLeading}>
                <Icon name="mcp" size={14} />
              </Row.Leading>
              <Row.Body>
                <Row.Label xstyle={styles.rowTitle}>{plugin.id}</Row.Label>
                <Row.Description title={pluginDetail(plugin)}>
                  {pluginDetail(plugin)}
                </Row.Description>
              </Row.Body>
              <span
                {...props(
                  plugin.status === "failed" && intent.danger,
                  styles.badge,
                  plugin.status === "failed" && styles.failedBadge,
                )}
              >
                {plugin.status}
              </span>
            </Row>
          ))}
        </div>
      );
    case "skills":
      return (
        <div {...props(styles.list)}>
          {inventory.skills.map((skill) => (
            <Row key={skill.filePath} xstyle={styles.row}>
              <Row.Leading xstyle={styles.rowLeading}>
                <Icon name="skills" size={14} />
              </Row.Leading>
              <Row.Body>
                <Row.Label xstyle={styles.rowTitle}>{skill.name}</Row.Label>
                <Row.Description title={skill.description}>{skill.description}</Row.Description>
              </Row.Body>
            </Row>
          ))}
        </div>
      );
    case "settings":
      return <PluginSettings sessionId={sessionId} settings={inventory.settings} />;
    default: {
      const _exhaustive: never = tab;

      return _exhaustive;
    }
  }
}

function emptyInventoryMessage(tab: CustomizeTab, searching: boolean): string {
  if (searching) return "No installed items match this search.";

  switch (tab) {
    case "plugins":
      return "No plugins or MCP servers are available.";
    case "skills":
      return "No skills are available.";
    case "settings":
      return "The active plugins do not expose settings.";
    default: {
      const _exhaustive: never = tab;

      return _exhaustive;
    }
  }
}

export function CustomizeSurface({
  sessionId,
}: {
  sessionId: SessionId | undefined;
}): ReactElement {
  const [tab, setTab] = useChromeTab("customize", CUSTOMIZE_TAB_IDS);
  const [query, setQuery] = useState("");
  const projectSettings = usePluginSettingsProjection(sessionId);

  const inventory = useQuery<CustomizeInventory>({
    queryKey: sessionId === undefined ? keys.pluginCatalog : ["customize", sessionId],
    select: (inventory) => ({ ...inventory, settings: projectSettings(inventory.settings) }),
    queryFn: async () => {
      if (sessionId === undefined) return nyte.plugins.catalog();

      const [plugins, settings, skills] = await Promise.all([
        nyte.plugins.list({ sessionId }),
        nyte.plugins.settings.list({ sessionId }),
        nyte.plugins.resources.list({ sessionId }),
      ]);

      return { plugins, settings, skills };
    },
  });

  const filtered = useMemo(
    () => filterInventory(inventory.data ?? EMPTY_INVENTORY, query),
    [inventory.data, query],
  );

  const searching = query.trim() !== "";

  return (
    <div data-nyte-customize-surface {...props(styles.surface)}>
      <Tabs.Root
        variant="pill"
        value={tab}
        xstyle={styles.root}
        onValueChange={(value) => {
          if (isOption(value, CUSTOMIZE_TAB_IDS)) setTab(value);
        }}
      >
        <search {...props(styles.searchRow)}>
          <InputGroup variant="quiet" xstyle={styles.searchField}>
            <Icon name="search" size={13} />
            <Input
              type="search"
              aria-label="Search inventory"
              autoComplete="off"
              spellCheck={false}
              placeholder="Search plugins, skills, and settings…"
              value={query}
              xstyle={styles.searchInput}
              onValueChange={setQuery}
            />
          </InputGroup>
        </search>

        <Tabs.List aria-label="Customize inventory">
          {CUSTOMIZE_TABS.map(([id, label]) => (
            <Tabs.Tab key={id} value={id}>
              {label}
            </Tabs.Tab>
          ))}
        </Tabs.List>

        {CUSTOMIZE_TABS.map(([panelTab]) => {
          const visibleCount = tabCount(filtered, panelTab);

          return (
            <Tabs.Panel
              key={panelTab}
              value={panelTab}
              render={<section />}
              xstyle={styles.inventory}
            >
              <div {...props(styles.inventoryHeading)}>
                <h1 {...props(styles.inventoryTitle)}>Installed</h1>
                {inventory.data !== undefined && (
                  <span aria-live="polite" {...props(styles.inventoryCount)}>
                    {visibleCount}
                  </span>
                )}
              </div>

              {inventory.isPending && <InventoryLoading />}
              {inventory.isError && (
                <div
                  role="alert"
                  title={inventory.error.message}
                  {...props(intent.danger, styles.error)}
                >
                  Couldn&rsquo;t load plugins and skills. Try again.
                </div>
              )}
              {inventory.data !== undefined && visibleCount === 0 && (
                <div {...props(styles.quiet)}>{emptyInventoryMessage(panelTab, searching)}</div>
              )}
              {inventory.data !== undefined && visibleCount > 0 && (
                <Inventory sessionId={sessionId} inventory={filtered} tab={panelTab} />
              )}
            </Tabs.Panel>
          );
        })}
      </Tabs.Root>
    </div>
  );
}
