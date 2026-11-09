import { Button } from "@nyte-ai/ui/button";
import { platformColors } from "@nyte-ai/ui/platform-colors";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { hairline } from "@nyte-ai/ui/styles/hairline.stylex";
import { media, radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { appearance, role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { toast } from "@nyte-ai/ui/toast";
import { create, props } from "@stylexjs/stylex";
import { useRef, type ReactElement } from "react";
import { errorMessage } from "../contract/errors.ts";
import { preferences, useSetting } from "../preferences/index.ts";
import { BUILT_IN_THEMES } from "../theme/built-in-themes.ts";
import {
  findTheme,
  parseVscodeTheme,
  themeSwatch,
  type ColorScheme,
  type ThemeChoice,
  type ThemeChoices,
  type VscodeTheme,
} from "../theme/vscode-theme.ts";
import { settings } from "../theme/schema.stylex.ts";
import { SettingsRow, SettingsSection } from "./rows.tsx";

const SLOTS = [
  { scheme: "light", title: "Light mode" },
  { scheme: "dark", title: "Dark mode" },
] as const;

interface ThemeOption {
  readonly key: string;
  readonly label: string;
  readonly choice: ThemeChoice;
  readonly theme: VscodeTheme | null;
}

export function ThemesSettings(): ReactElement {
  const choices = useSetting(preferences.themes);
  const imported = useSetting(preferences.importedThemes);
  const picker = useRef<HTMLInputElement>(null);

  return (
    <>
      {SLOTS.map((slot) => (
        <SettingsSection key={slot.scheme} title={slot.title}>
          <ThemePicker scheme={slot.scheme} choices={choices} imported={imported} />
        </SettingsSection>
      ))}
      <SettingsSection title="Import">
        <SettingsRow
          title="Import a VS Code color theme"
          description="Nyte adds it to light or dark mode by its background color"
        >
          <input
            ref={picker}
            type="file"
            accept=".json,.jsonc,application/json"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";

              if (file !== undefined) void importTheme(file);
            }}
          />
          <Button variant="outline" onClick={() => picker.current?.click()}>
            Import…
          </Button>
        </SettingsRow>
        {imported.map((theme) => (
          <SettingsRow
            key={`${theme.scheme}:${theme.name}`}
            title={theme.name}
            description={theme.scheme === "dark" ? "Dark mode" : "Light mode"}
          >
            <Button variant="outline" onClick={() => removeTheme(theme)}>
              Remove
            </Button>
          </SettingsRow>
        ))}
      </SettingsSection>
    </>
  );
}

function ThemePicker({
  scheme,
  choices,
  imported,
}: {
  readonly scheme: ColorScheme;
  readonly choices: ThemeChoices;
  readonly imported: readonly VscodeTheme[];
}): ReactElement {
  const selected = findTheme(scheme, choices, imported);

  const option = (source: "built-in" | "imported", theme: VscodeTheme): ThemeOption => ({
    key: `${source}:${theme.name}`,
    label: theme.name,
    choice: { source, name: theme.name },
    theme,
  });

  const groups = [
    {
      label: "Default",
      options: [
        {
          key: "nyte",
          label: "Nyte",
          choice: { source: "nyte" },
          theme: null,
        } satisfies ThemeOption,
      ],
    },
    {
      label: "Imported",
      options: imported
        .filter((theme) => theme.scheme === scheme)
        .map((theme) => option("imported", theme)),
    },
    {
      label: "Built-in",
      options: BUILT_IN_THEMES.filter((theme) => theme.scheme === scheme).map((theme) =>
        option("built-in", theme),
      ),
    },
  ].filter((group) => group.options.length > 0);

  return (
    <div
      data-settings-row=""
      role="radiogroup"
      aria-label={scheme === "dark" ? "Dark mode theme" : "Light mode theme"}
      {...props(styles.picker)}
    >
      {groups.map((group, index) => (
        <div
          key={group.label}
          {...props(
            styles.group,
            index > 0 && hairline.inlineStart,
            index > 0 && styles.groupAfter,
            index === groups.length - 1 && styles.groupLast,
          )}
        >
          <span {...props(text.sm, styles.groupLabel)}>{group.label}</span>
          <div {...props(styles.cards)}>
            {group.options.map((entry) => (
              <ThemeCard
                key={entry.key}
                scheme={scheme}
                option={entry}
                checked={entry.theme === selected}
                onSelect={() => preferences.themes.set({ ...choices, [scheme]: entry.choice })}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ThemeCard({
  scheme,
  option,
  checked,
  onSelect,
}: {
  readonly scheme: ColorScheme;
  readonly option: ThemeOption;
  readonly checked: boolean;
  readonly onSelect: () => void;
}): ReactElement {
  const nyte = platformColors[scheme];
  const colors = option.theme === null ? undefined : themeSwatch(option.theme);

  const swatch = {
    base: colors?.base ?? nyte.bgBase,
    chrome: colors?.chrome ?? nyte.bgChrome,
    ink: colors?.ink ?? nyte.contentPrimary,
    accent: colors?.accent ?? nyte.buttonFill,
  };

  return (
    <label {...props(styles.card)}>
      <input
        type="radio"
        name={`theme-${scheme}`}
        value={option.key}
        checked={checked}
        onChange={onSelect}
        {...props(srOnly)}
      />
      <span
        aria-hidden="true"
        {...props(
          checked && intent.primary,
          hairline.ringAfter,
          styles.thumb(swatch.base),
          checked && styles.thumbOn,
        )}
      >
        <span {...props(styles.chrome(swatch.chrome))} />
        <span {...props(styles.body)}>
          <span {...props(text.xl, styles.sample(swatch.ink))}>Aa</span>
          <span {...props(styles.accent(swatch.accent))} />
        </span>
      </span>
      <span {...props(text.sm, styles.name, checked && styles.nameOn)}>{option.label}</span>
    </label>
  );
}

async function importTheme(file: File): Promise<void> {
  const content = await file.text();

  try {
    const theme = parseVscodeTheme(content, file.name);
    preferences.importedThemes.set([
      ...preferences.importedThemes
        .get()
        .filter((other) => other.name !== theme.name || other.scheme !== theme.scheme),
      theme,
    ]);
    preferences.themes.set({
      ...preferences.themes.get(),
      [theme.scheme]: { source: "imported", name: theme.name },
    });
  } catch (cause) {
    toast.add({
      type: "error",
      title: `Couldn't use ${file.name}`,
      description: errorMessage(cause),
    });
  }
}

function removeTheme(theme: VscodeTheme): void {
  const choices = preferences.themes.get();
  const choice = choices[theme.scheme];

  if (choice.source === "imported" && choice.name === theme.name)
    preferences.themes.set({ ...choices, [theme.scheme]: { source: "nyte" } });
  preferences.importedThemes.set(
    preferences.importedThemes
      .get()
      .filter((other) => other.name !== theme.name || other.scheme !== theme.scheme),
  );
}

const CARD_WIDTH = 112;

const styles = create({
  picker: {
    display: "flex",
    flexWrap: "wrap",
    rowGap: space.s3,
    padding: settings.rowPadding,
  },
  group: { display: "flex", flexDirection: "column", gap: space.s2 },
  groupAfter: { marginInlineStart: space.s4, paddingInlineStart: space.s4 },
  groupLast: { flex: "1 1 0", minWidth: CARD_WIDTH },
  groupLabel: { color: role.contentTertiary },
  cards: { display: "flex", flexWrap: "wrap", gap: space.s2 },
  card: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.s1,
    borderRadius: radius.card,
    outlineStyle: { default: "none", ":has(:focus-visible)": "solid" },
    outlineWidth: 2,
    outlineColor: appearance.focusRing,
    outlineOffset: 4,
    cursor: appearance.cursorInteractive,
  },
  thumb: (base: string) => ({
    position: "relative",
    display: "flex",
    width: CARD_WIDTH,
    height: 68,
    overflow: "clip",
    borderRadius: radius.card,
    backgroundColor: base,
    outlineStyle: { default: "none", [media.hover]: { ":hover": "solid" } },
    outlineWidth: 2,
    outlineColor: role.strokeTertiary,
    outlineOffset: 2,
  }),
  thumbOn: {
    outlineStyle: "solid",
    outlineColor: role.bgInteractiveStrong,
  },
  chrome: (chrome: string) => ({ width: "20%", flexShrink: 0, backgroundColor: chrome }),
  body: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: space.s1_5,
    flex: 1,
    paddingInline: space.s3,
  },
  sample: (ink: string) => ({ color: ink, fontWeight: type.weightMedium }),
  accent: (accent: string) => ({
    width: "40%",
    height: space.s1_5,
    borderRadius: radius.pill,
    backgroundColor: accent,
  }),
  name: { maxWidth: CARD_WIDTH, color: role.contentSecondary, textAlign: "center" },
  nameOn: { color: role.contentPrimary, fontWeight: type.weightSemibold },
});
