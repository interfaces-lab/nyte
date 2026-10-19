/**
 * The settings pages that aren't hubs, each under its strip: rows come from
 * the settings draft's catalog, so the strip is judged above a real page.
 * Appearance owns its hue and intensity here, so the strip repaints as they
 * move.
 */
import { props } from "@stylexjs/stylex";
import { useState, type ReactElement } from "react";
import { appearanceStyles as appearance } from "@nyte-ai/app/settings/appearance.stylex.ts";
import { settingsPatterns } from "@nyte-ai/app/theme/settings-patterns.stylex.ts";
import { Slider } from "@nyte-ai/ui/slider";
import { SECTIONS } from "../settings/catalog";
import { SettingRow } from "../settings/page";
import { AppearanceStrip, PAGE_STRIPS } from "./page-strips";

/** Which catalog groups a page shows: by section, and optionally by group title. */
const CATALOG = {
  general: { section: "general" },
  agent: { section: "agent" },
  editor: { section: "editor", except: "Terminal" },
  terminal: { section: "editor", only: "Terminal" },
  browser: { section: "browser" },
  advanced: { section: "advanced" },
} as const satisfies Readonly<
  Record<string, { readonly section: string; readonly only?: string; readonly except?: string }>
>;

export type StripPage = keyof typeof PAGE_STRIPS | "appearance";

function CatalogGroups({
  section,
  keep,
}: {
  readonly section: string;
  readonly keep: (title: string | undefined) => boolean;
}): ReactElement {
  const groups = SECTIONS.find((entry) => entry.id === section)?.groups ?? [];

  return (
    <>
      {groups
        .filter((group) => keep(group.title))
        .map((group, index) => (
          <section key={group.title ?? index} {...props(settingsPatterns.section)}>
            {group.title !== undefined && (
              <div {...props(settingsPatterns.sectionHeader)}>
                <h2 {...props(settingsPatterns.sectionTitle)}>{group.title}</h2>
              </div>
            )}
            <div {...props(settingsPatterns.group)}>
              {group.settings.map((setting) => (
                <SettingRow key={setting.title} setting={setting} annotated={false} />
              ))}
            </div>
          </section>
        ))}
    </>
  );
}

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

function AppearancePage(): ReactElement {
  const [hue, setHue] = useState(250);
  const [intensity, setIntensity] = useState(100);

  return (
    <>
      <AppearanceStrip hue={hue} intensity={intensity} />
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
      <CatalogGroups section="appearance" keep={(title) => title !== "Colors"} />
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

export function StripPageBody({ page }: { readonly page: StripPage }): ReactElement {
  if (page === "appearance") return <AppearancePage />;
  const PageStrip = PAGE_STRIPS[page];

  if (page === "usage") {
    return (
      <>
        <PageStrip />
        <UsagePage />
      </>
    );
  }

  const catalog: { readonly section: string; readonly only?: string; readonly except?: string } =
    CATALOG[page];

  return (
    <>
      <PageStrip />
      <CatalogGroups
        section={catalog.section}
        keep={(title) =>
          (catalog.only === undefined || title === catalog.only) &&
          (catalog.except === undefined || title !== catalog.except)
        }
      />
    </>
  );
}
