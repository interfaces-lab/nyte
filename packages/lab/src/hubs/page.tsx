/**
 * Every settings page under its strip, in the app's settings frame. The hub
 * pages (Profile, Providers, and Remote access) load, then simulate sources
 * connecting, failing, and disconnecting, so the loading and syncing states
 * can be judged in motion; their strip lights as sources connect, or switches
 * back to the isometric hub. Pages stay mounted while hidden, so switching
 * keeps what was connected.
 */
import { create, props } from "@stylexjs/stylex";
import { useState, type ReactElement } from "react";
import { sidebarStyles as rail } from "@nyte-ai/app/chrome/sidebar.stylex.ts";
import { settingsStyles as shell } from "@nyte-ai/app/settings/settings.stylex.ts";
import { shell as frame, sidebar } from "@nyte-ai/app/theme/schema.stylex.ts";
import { settingsPatterns } from "@nyte-ai/app/theme/settings-patterns.stylex.ts";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Row } from "@nyte-ai/ui/row";
import { Toaster } from "@nyte-ai/ui/toast";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { DISPLAY_MODES, useDisplayMode, type DisplayMode } from "../shell/display-mode";
import type { IconName } from "@nyte-ai/ui/icon";
import { HubSettings } from "./hub-settings";
import { SCENES, type Scene } from "./scenes";
import { StripPageBody, type StripPage } from "./strip-pages";

type Page = {
  readonly id: string;
  readonly title: string;
  readonly icon: IconName;
} & (
  | { readonly kind: "hub"; readonly scene: Scene }
  | { readonly kind: "strip"; readonly page: StripPage }
);

function hub(id: string): Page | undefined {
  const scene = SCENES.find((entry) => entry.id === id);

  return scene === undefined
    ? undefined
    : { id, title: scene.title, icon: scene.icon, kind: "hub", scene };
}

function still(page: StripPage, title: string, icon: IconName): Page {
  return { id: page, title, icon, kind: "strip", page };
}

/** The app's settings nav, in its groups, with Remote access after Providers. */
const GROUPS: readonly (readonly Page[])[] = [
  [hub("profile")],
  [
    still("general", "General", "settings"),
    still("appearance", "Appearance", "canvas-grid"),
    still("usage", "Usage", "trending"),
  ],
  [
    still("agent", "Agent", "agent"),
    still("editor", "Editor", "file-text"),
    still("terminal", "Terminal", "console"),
    still("browser", "Browser", "globe"),
    still("advanced", "Advanced", "code-brackets"),
  ],
  [hub("providers"), hub("remote")],
].map((group) => group.filter((page) => page !== undefined));

const PAGES = GROUPS.flat();

const ARTS = [
  { value: "strip", label: "Strip" },
  { value: "hub", label: "Hub" },
] as const;

const LOAD_MS = 1400;

const LOAD_STAGGER_MS = 350;

export function HubsPage(): ReactElement {
  const [scheme, setScheme] = useState<DisplayMode>("dark");
  const [active, setActive] = useState("providers");
  const [art, setArt] = useState<"strip" | "hub">("strip");
  const [run, setRun] = useState(0);
  const current = PAGES.find((page) => page.id === active) ?? PAGES[0];

  useDisplayMode(scheme);

  return (
    <div {...props(styles.page)}>
      <nav aria-label="Settings pages" {...props(shell.navigation, styles.rail)}>
        <div {...props(shell.navGroups)}>
          {GROUPS.map((group) => (
            <div key={group[0]?.id} {...props(shell.navList)}>
              {group.map((page) => (
                <Row
                  key={page.id}
                  variant="nav"
                  selected={page.id === current?.id}
                  aria-current={page.id === current?.id ? "page" : undefined}
                  xstyle={rail.navRow}
                  onClick={() => setActive(page.id)}
                >
                  <Row.Leading xstyle={rail.navLeading}>
                    <Icon name={page.icon} size={14} />
                  </Row.Leading>
                  <Row.Label>{page.title}</Row.Label>
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
              <h1 {...props(settingsPatterns.pageTitle)}>{current?.title}</h1>
              <div {...props(styles.toolbar)}>
                {current?.kind === "hub" && (
                  <ToggleGroup
                    aria-label="Art"
                    value={[art]}
                    onValueChange={(values) => {
                      const next = ARTS.find((option) => option.value === values.at(-1));

                      if (next !== undefined) setArt(next.value);
                    }}
                  >
                    {ARTS.map((option) => (
                      <Toggle key={option.value} value={option.value} size="sm">
                        {option.label}
                      </Toggle>
                    ))}
                  </ToggleGroup>
                )}
                <ToggleGroup
                  aria-label="Scheme"
                  value={[scheme]}
                  onValueChange={(values) => {
                    const next = DISPLAY_MODES.find((mode) => mode.value === values.at(-1));

                    if (next !== undefined) setScheme(next.value);
                  }}
                >
                  {DISPLAY_MODES.map((mode) => (
                    <Toggle key={mode.value} value={mode.value} size="sm">
                      {mode.label}
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
            {PAGES.map((page, index) => (
              <div
                key={`${page.id}-${run}`}
                {...props(shell.panel, page.id !== current?.id && styles.hidden)}
              >
                {page.kind === "hub" ? (
                  <HubSettings
                    scene={page.scene}
                    loadMs={LOAD_MS + (index % 3) * LOAD_STAGGER_MS}
                    art={art}
                  />
                ) : (
                  <StripPageBody page={page.page} />
                )}
              </div>
            ))}
          </div>
        </div>
      </main>
      <Toaster />
    </div>
  );
}

const styles = create({
  /** The app's chrome: the settings rail on the sidebar's material, the page in a card set into it. */
  page: {
    display: "flex",
    boxSizing: "border-box",
    height: "100dvh",
    paddingBlockStart: frame.titlebarHeight,
    backgroundColor: role.sidebarMaterial,
    color: role.contentPrimary,
    fontFamily: type.fontSans,
  },
  rail: { flex: "none", width: sidebar.width },
  card: {
    marginInlineEnd: frame.cardInset,
    marginBlockEnd: frame.cardInset,
    borderRadius: radius.card,
    boxShadow: `0 0 0 1px ${role.borderSecondaryTranslucent}`,
  },
  toolbar: { display: "flex", alignItems: "center", gap: space.s2 },
  hidden: { display: "none" },
});
