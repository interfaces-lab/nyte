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

const SURFACES = [
  { id: "none", label: "None" },
  { id: "popover", label: "Popover" },
  { id: "context", label: "Context menu" },
  { id: "dialog", label: "Dialog" },
] as const satisfies readonly { readonly id: Surface; readonly label: string }[];

const DESKS = [
  { id: "photo", label: "Photo" },
  { id: "grid", label: "Grid" },
  { id: "flat", label: "Flat" },
] as const;

export function Lab(): ReactElement {
  const [appearance, setAppearance] = useState<Appearance>("light");
  const [desk, setDesk] = useState<string>("photo");
  const [surface, setSurface] = useState<Surface>("popover");
  const [sources, setSources] = useState<Readonly<Record<string, Source>>>({});

  /*
   * The wax recipe is the one thing here worth tuning by eye rather than by
   * argument, so it goes on dials. Defaults are Notion's shipped values.
   */
  const dials = useDialKit("Material", {
    alpha: [0.8, 0.5, 1, 0.01],
    blur: [12, 0, 32, 1],
    brightness: [100, 80, 140, 1],
    radius: [12, 0, 20, 1],
    hairline: [0.08, 0, 0.3, 0.005],
  });

  /*
   * Overrides go through a stylesheet rather than the `style` prop: a record of
   * custom properties is not assignable to `CSSProperties`, and the repo bans
   * casts. A scoped rule is also what the real app would ship.
   */
  const overrides: Record<string, string> = {
    "--nds-wax-alpha": String(dials.alpha),
    "--nds-wax-blur": `${String(dials.blur)}px`,
    "--nds-wax-brightness": `${String(dials.brightness)}%`,
    "--nds-wax-radius": `${String(dials.radius)}px`,
    "--nds-stroke-alpha": String(dials.hairline),
  };

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
          The desktop's own layout — traffic-light lane, rail with primary actions and account row,
          a pane carrying its own header, the transcript on its 840px measure — painted with NDS.
          The table below swaps one token at a time back to what Nyte ships, so you can see which
          decision is actually doing the work. The material is on dials, bottom right.
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
          <strong>One material, three surfaces.</strong> Popover, context menu and dialog share{" "}
          <code>wax.surface</code>. Nothing decides per component whether it is translucent, which
          is how they stay consistent when one of them moves.
        </li>
        <li {...stylex.props(lab.note)}>
          <strong>Mixed ramps.</strong> NDS steps 30 and 100–400 are alpha, 50 and 500–900 are
          solid. Washes composite anywhere; text and fills have contrast you can reason about.
          Nyte's ramp is alpha the whole way, so it has nothing to fall back to when transparency is
          off.
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
          <strong>Cost.</strong> Three <code>backdrop-filter</code> surfaces is real GPU work per
          frame in Electron, and the one thing here Nyte does not pay for today. Worth profiling
          against a long transcript before committing.
        </li>
        <li {...stylex.props(lab.note)}>
          <strong>Not measured here.</strong> Contrast ratios. Several NDS steps are alpha over an
          unknown backdrop, so WCAG has to be checked against real surfaces rather than the token.
        </li>
      </ol>

      <DialRoot position="bottom-right" defaultOpen={false} theme="dark" />
    </div>
  );
}
