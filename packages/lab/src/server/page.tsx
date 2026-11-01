/**
 * The Server settings page redone around one server lifecycle, after Rex's server card. It opens on
 * the poster (up for two hours, address ready); Replay plays the story from off: Start, the
 * address resolving in place, then Copy and Pair lighting up. The host is simulated here.
 */
import { create, props } from "@stylexjs/stylex";
import { useEffect, useReducer, useState, type ReactElement } from "react";
import { sidebarStyles as rail } from "@nyte-ai/app/sidebar/sidebar.stylex.ts";
import { settingsStyles as shell } from "@nyte-ai/app/settings/settings.stylex.ts";
import { shell as frame, sidebar } from "@nyte-ai/app/theme/schema.stylex.ts";
import { settingsPatterns } from "@nyte-ai/app/theme/settings-patterns.stylex.ts";
import { Button } from "@nyte-ai/ui/button";
import { Icon, type IconName } from "@nyte-ai/ui/icon";
import { Input, InputGroup } from "@nyte-ai/ui/input";
import { Row } from "@nyte-ai/ui/row";
import { Toaster } from "@nyte-ai/ui/toast";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { avatar, radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { OFF, poster, reduce, type Scenario, type Server } from "./model";
import { ServerView } from "./server-view";

/** How long an address takes to come up: long enough to read "Starting…". */
const RESOLVE_MS = 2400;

/** The pause on the off state before the story presses Start. */
const START_MS = 1200;

const NOW_TICK_MS = 5000;

const SCENARIOS = [
  { value: "healthy", label: "Healthy" },
  { value: "unreachable", label: "Unreachable" },
] as const satisfies readonly { readonly value: Scenario; readonly label: string }[];

/** The pages below the Server card, which leads the nav and is the page settings opens on. */
const NAV: readonly (readonly (readonly [IconName, string])[])[] = [
  [["user", "Profile"]],
  [
    ["settings", "General"],
    ["bell", "Notifications"],
    ["canvas-grid", "Appearance"],
  ],
  [
    ["agent", "Agent"],
    ["file-text", "Editor"],
    ["console", "Terminal"],
  ],
];

export function ServerPage(): ReactElement {
  const [scenario, setScenario] = useState<Scenario>("healthy");
  const [world, dispatch] = useReducer(reduce, undefined, poster);
  const [now, setNow] = useState(Date.now);
  const [run, setRun] = useState(0);
  const [search, setSearch] = useState("");
  const query = search.trim().toLocaleLowerCase();

  const groups = NAV.flatMap((group) => {
    const matches = group.filter(([, title]) => title.toLocaleLowerCase().includes(query));

    return matches.length > 0 ? [matches] : [];
  });

  const resolving = world.server.kind === "running" && world.server.address.kind === "resolving";

  // oxlint-disable-next-line nyte-code/no-direct-effect -- the clock behind "Running for …"
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), NOW_TICK_MS);

    return () => window.clearInterval(timer);
  }, []);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- the simulated host resolving an address
  useEffect(() => {
    if (!resolving) return undefined;

    const timer = window.setTimeout(() => dispatch({ kind: "resolve", scenario }), RESOLVE_MS);

    return () => window.clearTimeout(timer);
  }, [resolving, scenario]);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- Replay's script: off, then Start
  useEffect(() => {
    if (run === 0) return undefined;
    dispatch({ kind: "reset", world: OFF });

    const timer = window.setTimeout(() => {
      setNow(Date.now());
      dispatch({ kind: "start", now: Date.now() });
    }, START_MS);

    return () => window.clearTimeout(timer);
  }, [run]);

  return (
    <div {...props(styles.page)}>
      <nav aria-label="Settings pages" {...props(shell.navigation, styles.rail)}>
        <InputGroup variant="quiet" xstyle={shell.search}>
          <span {...props(shell.searchIcon)}>
            <Icon name="search" size="sm" />
          </span>
          <Input
            type="search"
            aria-label="Search Settings"
            autoComplete="off"
            spellCheck={false}
            placeholder="Search Settings"
            value={search}
            onValueChange={setSearch}
          />
        </InputGroup>
        <div {...props(shell.navGroups)}>
          {"server".includes(query) && (
            <Row
              variant="nav"
              size="lg"
              selected
              aria-current="page"
              xstyle={[rail.navRow, styles.serverCard]}
            >
              <Row.Leading xstyle={styles.serverMark}>
                <img src="/icon.svg" alt="" {...props(styles.mark)} />
              </Row.Leading>
              <Row.Body>
                <Row.Label xstyle={styles.serverTitle}>Server</Row.Label>
                <Row.Description>{serverStatus(world.server)}</Row.Description>
              </Row.Body>
            </Row>
          )}
          {groups.map((group) => (
            <div key={group[0]?.[1]} {...props(shell.navList)}>
              {group.map(([icon, title]) => (
                <Row key={title} variant="nav" xstyle={rail.navRow}>
                  <Row.Leading xstyle={rail.navLeading}>
                    <Icon name={icon} size="sm" />
                  </Row.Leading>
                  <Row.Label>{title}</Row.Label>
                </Row>
              ))}
            </div>
          ))}
        </div>
      </nav>

      <main data-nyte-scrollport="balanced" {...props(shell.content, styles.card)}>
        <div {...props(shell.contentInner)}>
          <div {...props(shell.panel)}>
            <div {...props(shell.titleRow)}>
              <h1 {...props(settingsPatterns.pageTitle)}>Server</h1>
              <div {...props(styles.toolbar)}>
                <ToggleGroup
                  aria-label="Scenario"
                  value={[scenario]}
                  onValueChange={(values) => {
                    const next = SCENARIOS.find((option) => option.value === values.at(-1));

                    if (next !== undefined) setScenario(next.value);
                  }}
                >
                  {SCENARIOS.map((option) => (
                    <Toggle key={option.value} value={option.value} size="sm">
                      {option.label}
                    </Toggle>
                  ))}
                </ToggleGroup>
                <Button
                  variant="outline"
                  size="sm"
                  icon="refresh"
                  onClick={() => setRun((count) => count + 1)}
                >
                  Replay
                </Button>
              </div>
            </div>
            <ServerView world={world} now={now} dispatch={dispatch} />
          </div>
        </div>
      </main>
      <Toaster />
    </div>
  );
}

function serverStatus(server: Server): string {
  if (server.kind === "off") return "Not running";

  return server.address.kind === "resolving" ? "Starting…" : "Running";
}

const styles = create({
  page: {
    display: "flex",
    boxSizing: "border-box",
    flex: 1,
    minHeight: 0,
    paddingBlockStart: frame.titlebarHeight,
    backgroundColor: role.sidebarMaterial,
    color: role.contentPrimary,
    fontFamily: type.fontSans,
  },
  rail: { flex: "none", width: sidebar.width },
  serverCard: { gap: space.s2_5 },
  serverMark: { width: avatar.md },
  mark: {
    display: "block",
    width: avatar.md,
    height: avatar.md,
    borderRadius: radius.control,
  },
  serverTitle: { fontWeight: type.weightSemibold },
  card: {
    marginInlineEnd: frame.cardInset,
    marginBlockEnd: frame.cardInset,
    borderRadius: frame.cardRadius,
    boxShadow: `0 0 0 1px ${role.borderSecondaryTranslucent}`,
  },
  toolbar: { display: "flex", alignItems: "center", gap: space.s2 },
});
