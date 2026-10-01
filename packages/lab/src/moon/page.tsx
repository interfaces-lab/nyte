import { applyDisplayMode } from "@nyte-ai/app/theme/appearance.ts";
import { glyph, row } from "@nyte-ai/ui/schema.stylex";
import { create, props } from "@stylexjs/stylex";
import { useEffect, useLayoutEffect, useState } from "react";
import { MOON_STATES, type MoonState } from "./dither";
import { BrailleMoon, Moon, STATE_COLOR } from "./moon";

/* A scripted turn, so the transitions can be watched without clicking. */
const RUN: readonly (readonly [MoonState, number])[] = [
  ["working", 2400],
  ["thinking", 2200],
  ["working", 1800],
  ["retrying", 2200],
  ["working", 1600],
  ["waiting", 2600],
  ["compacting", 2000],
  ["working", 1600],
  ["done", 2600],
];

const SESSIONS = [
  ["Fix flaky postgres store test", "working"],
  ["Explain the plugin loader", "thinking"],
  ["Ship the dithered app icon", "done"],
  ["Deploy preview to staging", "waiting"],
  ["Rate-limited model call", "retrying"],
  ["Migrate appcast signing", "failed"],
] as const satisfies readonly (readonly [string, MoonState])[];

/* Painted from literals: the page stands on the TUI's dark ground, not a token set. */
const styles = create({
  page: {
    minBlockSize: "100%",
    backgroundColor: "#0a0a0a",
    color: "#fafafa",
    fontFamily: "'Inter Variable', system-ui, sans-serif",
    paddingBlock: 72,
    paddingInline: 80,
    display: "flex",
    flexDirection: "column",
    gap: 56,
  },
  label: {
    fontFamily: "ui-monospace, Menlo, monospace",
    fontSize: 11,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "#737373",
  },
  title: { margin: 0, fontSize: 40, lineHeight: "44px", letterSpacing: "-0.03em", fontWeight: 600 },
  hero: { display: "flex", gap: 56, alignItems: "center" },
  picker: { display: "flex", flexWrap: "wrap", gap: 6, maxInlineSize: 420 },
  chip: {
    borderWidth: 0,
    borderRadius: 999,
    paddingBlock: 6,
    paddingInline: 12,
    fontFamily: "ui-monospace, Menlo, monospace",
    fontSize: 12,
    cursor: "pointer",
    backgroundColor: { default: "#171717", ":hover": "#262626" },
    color: "#a3a3a3",
  },
  chipOn: { backgroundColor: "#262626", color: "#fafafa" },
  row: { display: "flex", gap: 48, alignItems: "flex-start" },
  panel: {
    borderRadius: 14,
    backgroundColor: "#141414",
    boxShadow: "inset 0 0 0 1px #ffffff14",
    padding: 8,
    inlineSize: 300,
  },
  session: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    blockSize: row.heightMd,
    paddingInline: 8,
    borderRadius: 8,
    fontSize: 13,
    color: "#d4d4d4",
  },
  glyph: {
    inlineSize: glyph.box,
    blockSize: glyph.box,
    flexShrink: 0,
    display: "grid",
    placeItems: "center",
  },
  terminal: {
    fontFamily: "ui-monospace, Menlo, monospace",
    fontSize: 14,
    lineHeight: "20px",
    backgroundColor: "#0a0a0a",
    boxShadow: "inset 0 0 0 1px #ffffff1f",
    borderRadius: 10,
    padding: 16,
    inlineSize: 420,
    whiteSpace: "pre",
    color: "#a3a3a3",
  },
  grid: { display: "flex", gap: 32, flexWrap: "wrap" },
  cell: { display: "flex", flexDirection: "column", gap: 10, alignItems: "center" },
});

function useScriptedRun(): MoonState {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setStep((index) => (index + 1) % RUN.length), RUN[step][1]);

    return () => clearTimeout(timer);
  }, [step]);

  return RUN[step][0];
}

const TUI_LABEL = {
  working: "Working",
  thinking: "Thinking…",
  retrying: "Retrying",
  compacting: "Compacting",
  waiting: "Waiting for your answer",
  done: "Worked",
  failed: "Failed",
  stopped: "Stopped",
} as const satisfies Readonly<Record<MoonState, string>>;

export function MoonPage() {
  useLayoutEffect(() => {
    applyDisplayMode("dark");
  }, []);
  const scripted = useScriptedRun();
  const [picked, setPicked] = useState<MoonState | null>(null);
  const state = picked ?? scripted;

  return (
    <main {...props(styles.page)}>
      <header>
        <div {...props(styles.label)}>Nyte · status glyph · motion</div>
        <h1 {...props(styles.title)}>The moon is the spinner.</h1>
      </header>

      <section {...props(styles.hero)}>
        <Moon state={state} cells={12} pitch={20} gap={6} />
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div {...props(styles.label)} style={{ color: STATE_COLOR[state] }}>
            {state}
            {picked === null ? " · scripted run" : ""}
          </div>
          <div {...props(styles.picker)}>
            <button
              type="button"
              onClick={() => setPicked(null)}
              {...props(styles.chip, picked === null && styles.chipOn)}
            >
              auto
            </button>
            {MOON_STATES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setPicked(option)}
                {...props(styles.chip, picked === option && styles.chipOn)}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section {...props(styles.row)}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div {...props(styles.label)}>Desktop · sidebar · 15px</div>
          <div {...props(styles.panel)}>
            {SESSIONS.map(([title, mark], index) => (
              <div key={title} {...props(styles.session)}>
                <span {...props(styles.glyph)}>
                  <Moon state={index === 0 ? state : mark} cells={5} pitch={3} />
                </span>
                {title}
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div {...props(styles.label)}>TUI · activity row · 2 cells</div>
          <div {...props(styles.terminal)}>
            <div>
              <span style={{ color: "#fafafa" }}>› </span>fix the flaky postgres test
            </div>
            <div> </div>
            <div>
              <BrailleMoon state={state} /> {TUI_LABEL[state]}
              <span style={{ color: "#525252" }}> · 12s</span>
            </div>
          </div>
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div {...props(styles.label)}>Every state · 4× · live</div>
        <div {...props(styles.grid)}>
          {MOON_STATES.map((option) => (
            <div key={option} {...props(styles.cell)}>
              <Moon state={option} cells={5} pitch={12} gap={4} />
              <div {...props(styles.label)} style={{ color: STATE_COLOR[option] }}>
                {option}
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
