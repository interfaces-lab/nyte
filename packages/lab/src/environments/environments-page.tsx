import { create, props } from "@stylexjs/stylex";
import { useState, type ReactElement } from "react";
import { customizeStyles } from "@nyte-ai/app/chrome/customize.stylex.ts";
import { Button } from "@nyte-ai/ui/button";
import { Icon, type IconName } from "@nyte-ai/ui/icon";
import { Input, InputGroup } from "@nyte-ai/ui/input";
import { Menu, MenuItem, MenuSeparator } from "@nyte-ai/ui/menu";
import { Row } from "@nyte-ai/ui/row";
import { Tabs } from "@nyte-ai/ui/tabs";
import { t } from "@nyte-ai/ui/vars.stylex";
import type { LabEnvironment } from "./fixtures";

const TABS = [
  ["connections", "Connections"],
  ["remote", "Remote access"],
] as const;

type Tab = (typeof TABS)[number][0];

/** Only what Customize has no piece for: a heading action and the badge tones. */
const styles = create({
  heading: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  titleGroup: { display: "flex", alignItems: "baseline", gap: 6 },
  onBadge: { backgroundColor: t.intentSuccessBg, color: t.intentSuccessContent },
});

interface Entry {
  readonly id: string;
  readonly icon: IconName;
  readonly title: string;
  readonly detail: string;
  readonly badge: string;
  readonly on: boolean;
  readonly actions: "connection" | "remote" | "none";
}

function connectionEntries(
  environments: readonly LabEnvironment[],
  home: string | undefined,
): readonly Entry[] {
  return environments.map((environment) => ({
    id: environment.id,
    icon: environment.icon,
    title: environment.name,
    detail:
      environment.id === home
        ? "Runs chats on this machine"
        : [
            environment.folders === undefined ? environment.reach : `Over ${environment.reach}`,
            environment.online ? undefined : "last seen 5h ago",
          ]
            .filter((part) => part !== undefined)
            .join(" · "),
    badge: environment.id === home ? "this device" : environment.online ? "online" : "offline",
    on: environment.online && environment.id !== home,
    actions: environment.id === home ? "none" : "connection",
  }));
}

const REMOTE_ENTRIES: readonly Entry[] = [
  {
    id: "tailnet",
    icon: "devices",
    title: "Over Tailscale",
    detail: "Serving nyte · 2 devices connected",
    badge: "on",
    on: true,
    actions: "remote",
  },
  {
    id: "local",
    icon: "computer",
    title: "This Mac only",
    detail: "A browser or the iOS Simulator on this machine",
    badge: "off",
    on: false,
    actions: "remote",
  },
];

function EntryRow({ entry }: { readonly entry: Entry }): ReactElement {
  return (
    <Row xstyle={customizeStyles.row}>
      <Row.Leading>
        <Icon name={entry.icon} size={14} />
      </Row.Leading>
      <Row.Body>
        <Row.Label xstyle={customizeStyles.rowTitle}>{entry.title}</Row.Label>
        <Row.Description title={entry.detail}>{entry.detail}</Row.Description>
      </Row.Body>
      <span {...props(customizeStyles.badge, entry.on && styles.onBadge)}>{entry.badge}</span>
      {entry.actions !== "none" && (
        <Menu
          label={`Actions for ${entry.title}`}
          align="end"
          trigger={<Button size="sm" iconOnly icon="more-horizontal" aria-label="More" />}
        >
          {entry.actions === "connection" ? (
            <>
              <MenuItem icon="new-chat" onSelect={() => undefined}>
                New chat here
              </MenuItem>
              <MenuItem icon="pencil" onSelect={() => undefined}>
                Edit address and token
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon="trash" danger onSelect={() => undefined}>
                Remove
              </MenuItem>
            </>
          ) : (
            <>
              <MenuItem icon="copy" onSelect={() => undefined}>
                Copy pairing link
              </MenuItem>
              <MenuItem icon="phone" onSelect={() => undefined}>
                Show QR code
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={entry.on ? "square" : "arrow-right"} onSelect={() => undefined}>
                {entry.on ? "Stop" : "Start"}
              </MenuItem>
            </>
          )}
        </Menu>
      )}
    </Row>
  );
}

function matches(query: string, entry: Entry): boolean {
  const needle = query.trim().toLocaleLowerCase();

  return (
    needle === "" ||
    [entry.title, entry.detail, entry.badge].some((value) =>
      value.toLocaleLowerCase().includes(needle),
    )
  );
}

/**
 * The Customize surface, item for item: search, pill tabs, a counted list.
 * Connections are the machines this app sends chats to; Remote access is who
 * can send chats to this Mac. Only the desktop can serve.
 */
export function EnvironmentsSurface({
  environments,
  home,
}: {
  readonly environments: readonly LabEnvironment[];
  readonly home: string | undefined;
}): ReactElement {
  const [tab, setTab] = useState<Tab>("connections");
  const [query, setQuery] = useState("");

  // Serving is the desktop's alone, so web has nothing to put under Remote access.
  const tabs = home === undefined ? TABS.filter(([id]) => id !== "remote") : TABS;

  const entries = {
    connections: connectionEntries(environments, home),
    remote: home === undefined ? [] : REMOTE_ENTRIES,
  } as const satisfies Readonly<Record<Tab, readonly Entry[]>>;

  return (
    <div {...props(customizeStyles.surface)}>
      <Tabs.Root
        variant="pill"
        value={tab}
        xstyle={customizeStyles.root}
        onValueChange={(value: unknown) => {
          const next = TABS.find(([id]) => id === value);

          if (next !== undefined) setTab(next[0]);
        }}
      >
        <search {...props(customizeStyles.searchRow)}>
          <InputGroup variant="quiet" xstyle={customizeStyles.searchField}>
            <Icon name="search" size={13} />
            <Input
              type="search"
              aria-label="Search environments"
              autoComplete="off"
              spellCheck={false}
              placeholder="Search machines and connections…"
              value={query}
              xstyle={customizeStyles.searchInput}
              onValueChange={setQuery}
            />
          </InputGroup>
        </search>

        <Tabs.List aria-label="Environments">
          {tabs.map(([id, label]) => (
            <Tabs.Tab key={id} value={id}>
              {label}
            </Tabs.Tab>
          ))}
        </Tabs.List>

        {tabs.map(([panel]) => {
          const visible = entries[panel].filter((entry) => matches(query, entry));

          return (
            <Tabs.Panel
              key={panel}
              value={panel}
              render={<section />}
              xstyle={customizeStyles.inventory}
            >
              <div {...props(customizeStyles.inventoryHeading, styles.heading)}>
                <span {...props(styles.titleGroup)}>
                  <h1 {...props(customizeStyles.inventoryTitle)}>
                    {panel === "connections" ? "Connected" : "Serving this Mac"}
                  </h1>
                  <span {...props(customizeStyles.inventoryCount)}>{visible.length}</span>
                </span>
                {panel === "connections" && (
                  <Button size="sm" icon="plus">
                    Add connection
                  </Button>
                )}
              </div>
              {visible.length === 0 ? (
                <div {...props(customizeStyles.list)}>
                  <div {...props(customizeStyles.quiet)}>Nothing matches this search.</div>
                </div>
              ) : (
                <div {...props(customizeStyles.list)}>
                  {visible.map((entry) => (
                    <EntryRow key={entry.id} entry={entry} />
                  ))}
                </div>
              )}
            </Tabs.Panel>
          );
        })}
      </Tabs.Root>
    </div>
  );
}
