"use client";

import { DialRoot, useDialKit } from "dialkit";
import "dialkit/styles.css";
import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { ReactElement } from "react";
import { AppShell } from "./app-shell";
import type { Surface } from "./app-shell";
import { lab } from "./lab.stylex";
import { frame } from "./shell.stylex";
import { TokenTable } from "./token-table";
import type { Source } from "./token-table";
import { TOKEN_ROWS } from "./token-map";

type Appearance = "light" | "dark";

/*
 * Dial rest positions are light mode's shipped values. Dark ships 0.9 alpha,
 * 120% brightness and a 0.055 hairline of its own, which is why an untouched
 * dial must write nothing at all.
 */
const DIAL_REST = { alpha: 0.8, blur: 12, brightness: 100, radius: 12, hairline: 0.08 } as const;

const SURFACES = [
  { id: "none", label: "None" },
  { id: "popover", label: "Popover" },
  { id: "context", label: "Context menu" },
  { id: "dialog", label: "Dialog" },
  { id: "stacked", label: "All layers" },
] as const satisfies readonly { readonly id: Surface; readonly label: string }[];

const DESKS = [
  { id: "photo", label: "Photo" },
  { id: "grid", label: "Grid" },
  { id: "flat", label: "Flat" },
] as const;

export function Lab(): ReactElement {
  const [appearance, setAppearance] = useState<Appearance>("light");
  const [desk, setDesk] = useState<string>("photo");
  const [surface, setSurface] = useState<Surface>("stacked");
  const [waxOn, setWaxOn] = useState(true);
  const [sources, setSources] = useState<Readonly<Record<string, Source>>>({});

  /*
   * The wax recipe is the one thing here worth tuning by eye rather than by
   * argument, so it goes on dials. Defaults are Notion's shipped values.
   */
  const dials = useDialKit("Material", {
    alpha: [DIAL_REST.alpha, 0.5, 1, 0.01],
    blur: [DIAL_REST.blur, 0, 32, 1],
    brightness: [DIAL_REST.brightness, 80, 140, 1],
    radius: [DIAL_REST.radius, 0, 20, 1],
    hairline: [DIAL_REST.hairline, 0, 0.3, 0.005],
  });

  /*
   * Overrides go through a stylesheet rather than the `style` prop: a record of
   * custom properties is not assignable to `CSSProperties`, and the repo bans
   * casts. A scoped rule is also what the real app would ship.
   */
  const overrides: Record<string, string> = {};

  /*
   * Only a moved dial is written. The rule sits at ID specificity, so emitting
   * a default would outrank the dark block and stop it ever showing its own
   * alpha, brightness and hairline.
   */
  if (dials.alpha !== DIAL_REST.alpha) overrides["--nds-wax-alpha"] = String(dials.alpha);
  if (dials.blur !== DIAL_REST.blur) overrides["--nds-wax-blur"] = `${String(dials.blur)}px`;
  if (dials.brightness !== DIAL_REST.brightness) {
    overrides["--nds-wax-brightness"] = `${String(dials.brightness)}%`;
  }
  if (dials.radius !== DIAL_REST.radius)
    overrides["--nds-wax-radius"] = `${String(dials.radius)}px`;
  if (dials.hairline !== DIAL_REST.hairline) {
    overrides["--nds-stroke-alpha"] = String(dials.hairline);
  }

  for (const row of TOKEN_ROWS) {
    if ((sources[row.id] ?? "nds") === "nyte") overrides[row.cssVar] = row.nyte;
  }

  const overrideCss = `#design-lab-frame{${Object.entries(overrides)
    .map(([name, value]) => `${name}:${value};`)
    .join("")}}`;

  return (
    <div {...stylex.props(lab.page)}>
      <style>{overrideCss}</style>
      <header {...stylex.props(lab.header)}>
        <h1 {...stylex.props(lab.heading)}>Nyte on Notion Calendar's tokens</h1>
        <p {...stylex.props(lab.lede)}>
          Nyte's layout, Notion's tokens — the nine-hue ramps, surfaces, text, strokes, shadows and
          states, lifted exactly. Surfaces are opaque the way Notion ships them; the material is on
          the floating panel alone, at 80% over <code>blur(12px)</code>. The table swaps one token
          at a time back to what Nyte ships. Dials for the material are bottom right.
        </p>
      </header>

      <div {...stylex.props(lab.controls)}>
        <div {...stylex.props(lab.control)}>
          <span {...stylex.props(lab.controlLabel)}>Surface</span>
          <div {...stylex.props(lab.segmented)}>
            {SURFACES.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={surface === option.id}
                {...stylex.props(lab.segment, surface === option.id && lab.segmentOn)}
                onClick={() => setSurface(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div {...stylex.props(lab.control)}>
          <span {...stylex.props(lab.controlLabel)}>Appearance</span>
          <div {...stylex.props(lab.segmented)}>
            {(["light", "dark"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={appearance === value}
                {...stylex.props(lab.segment, appearance === value && lab.segmentOn)}
                onClick={() => setAppearance(value)}
              >
                {value === "light" ? "Light" : "Dark"}
              </button>
            ))}
          </div>
        </div>

        <div {...stylex.props(lab.control)}>
          <span {...stylex.props(lab.controlLabel)}>Behind the window</span>
          <div {...stylex.props(lab.segmented)}>
            {DESKS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={desk === option.id}
                {...stylex.props(lab.segment, desk === option.id && lab.segmentOn)}
                onClick={() => setDesk(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <label {...stylex.props(lab.control, lab.checkbox)}>
          <input
            type="checkbox"
            checked={waxOn}
            onChange={(event) => setWaxOn(event.target.checked)}
          />
          <span {...stylex.props(lab.controlLabel)}>Material on floating surfaces</span>
        </label>
      </div>

      <div
        {...stylex.props(
          lab.desk,
          desk === "photo" && lab.deskPhoto,
          desk === "grid" && lab.deskGrid,
          desk === "flat" && lab.deskFlat,
        )}
      >
        <div {...stylex.props(lab.deskInner)}>
          <div
            id="design-lab-frame"
            data-nds
            data-appearance={appearance}
            data-wax={waxOn}
            {...stylex.props(frame.window)}
          >
            <AppShell surface={surface} onSurfaceChange={setSurface} />
          </div>
        </div>
      </div>

      <TokenTable
        sources={sources}
        onChange={(id, source) => setSources((prev) => ({ ...prev, [id]: source }))}
        onSetAll={(source) =>
          setSources(Object.fromEntries(TOKEN_ROWS.map((row) => [row.id, source])))
        }
      />

      <ol {...stylex.props(lab.notes)}>
        <li {...stylex.props(lab.note)}>
          <strong>Layering.</strong> <em>All layers</em> stacks four: desk → window → context menu →
          submenu, with a dialog and its scrim over the lot. Every floating surface is the same{" "}
          <code>wax.surface</code>, so the stack is a property of the token, not four separate
          decisions.
        </li>
        <li {...stylex.props(lab.note)}>
          <strong>Mixed ramps, in light.</strong> Steps 30 and 100–400 are alpha, 50 and 500–900
          solid, so washes composite anywhere and fills have contrast you can reason about. Dark
          inverts it on 63 of 198 steps and its gray ramp is solid throughout, so this is a
          light-mode property, not a system one.
        </li>
        <li {...stylex.props(lab.note)}>
          <strong>Try hover alone.</strong> Flip only <em>State · hover</em> to Nyte and run the
          pointer down the rail: an idle row you happen to be over goes heavier than the session you
          are in, because 8% beats the 6% selected step.
        </li>
        <li {...stylex.props(lab.note)}>
          <strong>Try ink alone.</strong> Flipping <em>Ink</em> back to <code>#141414</code> is the
          single biggest change in feel on this page, and it is independent of the material, the
          ramps and the states.
        </li>
        <li {...stylex.props(lab.note)}>
          <strong>Cost.</strong> Only one waxed surface is ever mounted here, so this page does not
          measure the real bill. In the app a menu over a live transcript is per-frame GPU work Nyte
          pays nothing for today. Profile before committing.
        </li>
        <li {...stylex.props(lab.note)}>
          <strong>Not measured here.</strong> Contrast ratios, and twelve tokens marked DERIVED in
          <code> tokens.css</code> that Notion does not ship — both selected states among them,
          which is what the hover argument above rests on.
        </li>
      </ol>

      <DialRoot position="bottom-right" defaultOpen={false} theme="dark" />
    </div>
  );
}
