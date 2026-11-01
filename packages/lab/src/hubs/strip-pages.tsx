/**
 * The settings pages that aren't hubs, each under its strip, so the strip is
 * judged above the real page.
 * Appearance owns its hue and intensity here, so the strip repaints as they
 * move.
 */
import { props } from "@stylexjs/stylex";
import { useState, type ComponentType, type ReactElement } from "react";
import { appearanceStyles as appearance } from "@nyte-ai/app/settings/appearance.stylex.ts";
import { settingsPatterns } from "@nyte-ai/app/theme/settings-patterns.stylex.ts";
import { Slider } from "@nyte-ai/ui/slider";
import { AgentSettings } from "@nyte-ai/app/settings/agent.tsx";
import { AppearanceSettings } from "@nyte-ai/app/settings/appearance.tsx";
import { BrowserSettings } from "@nyte-ai/app/settings/browser.tsx";
import { DeveloperSettings } from "@nyte-ai/app/settings/developer.tsx";
import { EditorSettings } from "@nyte-ai/app/settings/editor.tsx";
import { GeneralSettings } from "@nyte-ai/app/settings/general.tsx";
import { TerminalSettings } from "@nyte-ai/app/settings/terminal.tsx";
import { AppearanceStrip, AppearanceWavesStrip, PAGE_STRIPS } from "./page-strips";

/** The real settings page each strip sits above. */
const PAGES = {
  general: GeneralSettings,
  agent: AgentSettings,
  editor: EditorSettings,
  terminal: TerminalSettings,
  browser: BrowserSettings,
  developer: DeveloperSettings,
} as const satisfies Readonly<Record<string, ComponentType>>;

export type StripPage = keyof typeof PAGE_STRIPS | "appearance";

export type AppearanceArt = "brush" | "waves";

function TintRow({
  title,
  description,
  label,
  max,
  value,
  valueText,
  onValueChange,
}: {
  readonly title: string;
  readonly description: string;
  readonly label: string;
  readonly max: number;
  readonly value: number;
  readonly valueText: string;
  readonly onValueChange: (value: number) => void;
}): ReactElement {
  return (
    <div {...props(settingsPatterns.rowRule, settingsPatterns.row)}>
      <span {...props(settingsPatterns.rowCopy)}>
        <span {...props(settingsPatterns.rowTitle)}>{title}</span>
        <span {...props(settingsPatterns.rowDescription)}>{description}</span>
      </span>
      <span {...props(settingsPatterns.rowControl)}>
        <Slider.Root
          max={max}
          value={value}
          xstyle={appearance.tintSlider}
          onValueChange={onValueChange}
        >
          <Slider.Control>
            <Slider.Track>
              <Slider.Thumb aria-label={label} aria-valuetext={valueText} />
            </Slider.Track>
          </Slider.Control>
        </Slider.Root>
      </span>
    </div>
  );
}

function AppearancePage({ art }: { readonly art: AppearanceArt }): ReactElement {
  const [hue, setHue] = useState(250);
  const [intensity, setIntensity] = useState(100);

  return (
    <>
      {art === "waves" ? (
        <AppearanceWavesStrip hue={hue} intensity={intensity} />
      ) : (
        <AppearanceStrip hue={hue} intensity={intensity} />
      )}
      <section {...props(settingsPatterns.section)}>
        <div {...props(settingsPatterns.sectionHeader)}>
          <h2 {...props(settingsPatterns.sectionTitle)}>Colors</h2>
        </div>
        <div {...props(settingsPatterns.group)}>
          <TintRow
            title="Hue"
            description="Tint backgrounds and surfaces toward one color"
            label="Tint hue"
            max={360}
            value={hue}
            valueText={`${String(hue)} degrees`}
            onValueChange={setHue}
          />
          <TintRow
            title="Intensity"
            description="How strongly the tint shows. All the way left turns it off"
            label="Tint intensity"
            max={100}
            value={intensity}
            valueText={`${String(intensity)} percent`}
            onValueChange={setIntensity}
          />
        </div>
      </section>
      <AppearanceSettings />
    </>
  );
}

function UsagePage(): ReactElement {
  return (
    <section {...props(settingsPatterns.section)}>
      <div {...props(settingsPatterns.group)}>
        <div {...props(settingsPatterns.rowRule, settingsPatterns.row)}>
          <span {...props(settingsPatterns.rowCopy)}>
            <span {...props(settingsPatterns.rowTitle)}>1.2M tokens in the last 7 days</span>
            <span {...props(settingsPatterns.rowDescription)}>
              Up 18% on the week before. $12.40 across 4 providers
            </span>
          </span>
        </div>
      </div>
    </section>
  );
}

export function StripPageBody({
  page,
  appearanceArt,
}: {
  readonly page: StripPage;
  readonly appearanceArt: AppearanceArt;
}): ReactElement {
  if (page === "appearance") return <AppearancePage art={appearanceArt} />;
  const PageStrip = PAGE_STRIPS[page];

  if (page === "usage") {
    return (
      <>
        <PageStrip />
        <UsagePage />
      </>
    );
  }

  const Page = PAGES[page];

  return (
    <>
      <PageStrip />
      <Page />
    </>
  );
}
