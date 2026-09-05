"use client";

import { useEffect, useRef, useState } from "react";
import type { ComponentType, ReactElement, ReactNode } from "react";
import {
  IconArrowUp,
  IconBlocks,
  IconChevronRightMedium,
  IconCollaborationPointerRight,
  IconFolderOpen,
  IconMagnifyingGlass,
  IconPlusSmall,
  IconSettingsGear2,
} from "central-icons-desktop";

/*
 * One run, two hosts. The terminal and the Electron client draw the same
 * transcript from one timeline: every row exists in both windows under the
 * same key, and a tick flips the row's state in both at once. Neither host
 * is told about the other, which is the point.
 *
 * Vocabulary, glyphs, sizes, and colours are the hosts' own:
 *   packages/tui/src/constants.ts, theme.ts, format.ts
 *   packages/desktop/src/renderer/src/conversation/tool-detail.ts, composer.tsx
 *   packages/desktop/src/renderer/src/chrome/sidebar.tsx, theme/tokens.css
 */

type RowState = "running" | "done" | "failed";
type Phase = "thinking" | "working" | "settled";

interface ToolRow {
  key: string;
  /** desktop verbs (tool-detail.ts VERBS) */
  verb: { running: string; done: string; failed?: string };
  /** desktop detail column */
  detail: string;
  /** terminal heading: `<tool> <title>` */
  term: string;
  /** terminal result summary, dim, after the heading */
  summary: string;
  /** desktop diff stats */
  stats?: { added: number; removed: number };
}

const PROMPT =
  "Password reset links started 404ing after yesterday's deploy. Can you find out why?";

const TOOLS: readonly ToolRow[] = [
  {
    key: "t1",
    verb: { running: "Running", done: "Ran" },
    detail: "git log --oneline -3 -- src/auth src/routes",
    term: "bash git log --oneline -3 -- src/auth src/routes",
    summary: "3 lines",
  },
  {
    key: "t2",
    verb: { running: "Reading", done: "Read" },
    detail: "auth/reset.ts",
    term: "read auth/reset.ts",
    summary: "38 lines · ctrl+o expand",
  },
  {
    key: "t3",
    verb: { running: "Running", done: "Ran", failed: "Command failed" },
    detail: "pnpm test --filter auth",
    term: "bash pnpm test --filter auth",
    summary: "exit 1",
  },
  {
    key: "t4",
    verb: { running: "Editing", done: "Edited" },
    detail: "auth/reset.ts",
    term: "edit auth/reset.ts",
    summary: "+1 -1",
    stats: { added: 1, removed: 1 },
  },
  {
    key: "t5",
    verb: { running: "Running", done: "Ran" },
    detail: "pnpm test --filter auth",
    term: "bash pnpm test --filter auth",
    summary: "12 passed",
  },
];

const ANSWER =
  "The reset page moved to `/account/reset-password` in yesterday's auth refactor, but `buildResetLink` still built links against the old path. Fixed in `src/auth/reset.ts`; the auth suite passes again.";
const ANSWER_WORDS = ANSWER.split(" ");

/* When each row changes state, in ms from the start of the run. */
const THINK_MS = 1400;
const TOOL_ENDS = [3000, 4000, 6600, 7800, 10400] as const;
const TOOL_OUTCOME: readonly RowState[] = ["done", "done", "failed", "done", "done"];
const WORD_MS = 70;
const SETTLE_MS = TOOL_ENDS[4] + ANSWER_WORDS.length * WORD_MS + 300;
const LOOP_MS = SETTLE_MS + 4200;

/* packages/tui/src/constants.ts */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"] as const;
const SPINNER_INTERVAL_MS = 130;

/* packages/tui/src/format.ts */
function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  return `${String(Math.floor(seconds))}s`;
}

interface Frame {
  t: number;
  think: RowState | undefined;
  tools: (RowState | undefined)[];
  words: number;
  phase: Phase;
}

function frameAt(t: number): Frame {
  const think: RowState = t < THINK_MS ? "running" : "done";
  const tools = TOOL_ENDS.map((end, i): RowState | undefined => {
    const start = i === 0 ? THINK_MS : TOOL_ENDS[i - 1];
    if (t < start) return undefined;
    if (t < end) return "running";
    return TOOL_OUTCOME[i];
  });
  const words =
    t < TOOL_ENDS[4] ? 0 : Math.min(ANSWER_WORDS.length, Math.floor((t - TOOL_ENDS[4]) / WORD_MS));
  const phase: Phase = t < THINK_MS ? "thinking" : t < SETTLE_MS ? "working" : "settled";
  return { t: Math.min(t, SETTLE_MS), think, tools, words, phase };
}

const SETTLED = frameAt(SETTLE_MS);

function useTimeline(): Frame {
  const [frame, setFrame] = useState<Frame>(() => frameAt(0));
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const tick = (now: number) => {
      if (reduced) {
        setFrame(SETTLED);
        return;
      }
      startRef.current ??= now;
      let t = now - startRef.current;
      if (t >= LOOP_MS) {
        startRef.current = now;
        t = 0;
      }
      setFrame(frameAt(t));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return frame;
}

export function TwoHosts() {
  const frame = useTimeline();
  const rootRef = useRef<HTMLDivElement>(null);

  // Both transcripts stay pinned to the newest row, as the real hosts do.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    for (const el of root.querySelectorAll<HTMLElement>("[data-pin]")) {
      el.scrollTop = el.scrollHeight;
    }
  }, [frame]);

  return (
    <>
      <div className="twin" ref={rootRef}>
        <Terminal frame={frame} />
        <Desktop frame={frame} />
      </div>
    </>
  );
}

/* Answer text with `code` spans, the same markup in both hosts. */
function Answer({ words }: { words: number }): ReactElement | null {
  if (words === 0) return null;
  const text = ANSWER_WORDS.slice(0, words).join(" ");
  const parts = text.split("`");
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? <code key={i}>{part}</code> : <span key={i}>{part}</span>,
      )}
    </>
  );
}

/* --------------------------------------------------------------- terminal */

const TERM_GLYPH: Record<RowState, string> = { running: "●", done: "✓", failed: "✗" };

function Terminal({ frame }: { frame: Frame }) {
  const spinner = SPINNER_FRAMES[Math.floor(frame.t / SPINNER_INTERVAL_MS) % SPINNER_FRAMES.length];
  const settled = frame.phase === "settled";

  return (
    <figure className="host term" role="img" aria-label="The Nyte terminal client, mid-run">
      <div className="term-titlebar">
        <span className="lights">
          <i />
          <i />
          <i />
        </span>
        <span className="t">nyte — nyte-sandbox</span>
      </div>
      <div className="term-body">
        <div className="term-tx" data-pin>
          <div className="u">{PROMPT}</div>
          {frame.think === "done" && (
            <div className="row think">
              <span className="g">◆</span>
              <span className="n">Thought</span>
            </div>
          )}
          {TOOLS.map((tool, i) => {
            const state = frame.tools[i];
            if (state === undefined) return null;
            return (
              <div key={tool.key}>
                <div className="row" data-state={state}>
                  <span className="g">{TERM_GLYPH[state]}</span>
                  <span className="n">{tool.term}</span>
                  {state !== "running" && <span className="s">{`  ${tool.summary}`}</span>}
                </div>
                {tool.stats && state === "done" && (
                  <div className="diff">
                    <span className="ln-no">10</span>
                    <span className="del">{'-  const path = "/reset-password";'}</span>
                    {"\n"}
                    <span className="ln-no">10</span>
                    <span className="ins">{'+  const path = "/account/reset-password";'}</span>
                  </div>
                )}
              </div>
            );
          })}
          {frame.words > 0 && (
            <div className="ans">
              <Answer words={frame.words} />
            </div>
          )}
          <div className="act" data-state={frame.phase}>
            {settled ? (
              `Worked for ${formatDuration(frame.t)}`
            ) : (
              <>
                <span className="g">{spinner}</span>
                <span>{frame.phase === "thinking" ? "Thinking…" : "Working"}</span>
              </>
            )}
          </div>
        </div>
        <div className="term-composer">
          <span className="p">❯</span>
          <span>{settled ? "Plan, search, build anything" : "Add a follow-up"}</span>
          <div className="term-status">
            <span className="ws">nyte-sandbox</span>
            <span className="sep"> │ </span>
            <span className="model">gpt-5.4</span>
            <span className="sep"> │ </span>
            <span className="lvl">medium</span>
          </div>
        </div>
        <div className="term-hints">
          <b>ctrl+k</b> commands · <b>ctrl+p</b> model · <b>shift+tab</b> thinking · <b>ctrl+g</b>{" "}
          editor
        </div>
      </div>
    </figure>
  );
}

/* ---------------------------------------------------------------- desktop */

type Glyph = ComponentType<{ size?: number; mode?: "raw" | "masked" }>;

/*
 * The desktop's Icon frame: a Central Icons glyph in raw mode under the
 * data-nyte-icon hook that thickens its stroke to 1.875 units.
 */
function AppIcon({ glyph: G, size }: { glyph: Glyph; size: number }) {
  return (
    <span data-nyte-icon="" aria-hidden="true">
      <G size={size} mode="raw" />
    </span>
  );
}

function Chevron() {
  return (
    <span className="chev">
      <AppIcon glyph={IconChevronRightMedium} size={12} />
    </span>
  );
}

function Desktop({ frame }: { frame: Frame }) {
  const settled = frame.phase === "settled";

  return (
    <figure className="host shot" role="img" aria-label="The Nyte desktop client, mid-run">
      <div className="app-titlebar">
        <span className="lights">
          <i />
          <i />
          <i />
        </span>
        <span className="t">Password reset 404s</span>
      </div>
      <div className="app-body">
        <aside className="app-sidebar">
          {/* sidebar.tsx: primaryActions, then the Workspaces section with the
              open workspace and its sessions. One session: this run. */}
          <div className="primary">
            <NavRow icon={<AppIcon glyph={IconCollaborationPointerRight} size={14} />}>
              New Chat
            </NavRow>
            <NavRow icon={<AppIcon glyph={IconMagnifyingGlass} size={14} />}>Search</NavRow>
            <NavRow icon={<AppIcon glyph={IconBlocks} size={14} />}>Customize</NavRow>
          </div>
          <div className="scroll">
            <div className="sh">Workspaces</div>
            <div className="row">
              <span className="ic">
                <AppIcon glyph={IconFolderOpen} size={14} />
              </span>
              <span className="l">nyte-sandbox</span>
            </div>
            <div className="row on">
              <span className="ic">{!settled && <i className="dot" aria-label="Running" />}</span>
              <span className="l">Password reset 404s</span>
              <span className="tr">now</span>
            </div>
          </div>
          <div className="sp" />
          <div className="gear">
            <AppIcon glyph={IconSettingsGear2} size={14} />
          </div>
        </aside>

        <div className="app-main">
          <div className="tx" data-pin>
            <div className="ucard">{PROMPT}</div>
            <div className="ln" data-state={frame.think}>
              <span className="v">{frame.think === "running" ? "Thinking" : "Thought"}</span>
              {frame.think === "done" && (
                <span className="d">{`· ${formatDuration(THINK_MS)}`}</span>
              )}
            </div>
            {TOOLS.map((tool, i) => {
              const state = frame.tools[i];
              if (state === undefined) return null;
              const verb =
                state === "failed" ? (tool.verb.failed ?? tool.verb.done) : tool.verb[state];
              return (
                <div key={tool.key} className="ln" data-state={state}>
                  <span className="v">{verb}</span>
                  <span className="d">{tool.detail}</span>
                  {tool.stats && state === "done" && (
                    <span className="st">
                      <span className="add">+{tool.stats.added}</span>
                      <span className="rem">-{tool.stats.removed}</span>
                    </span>
                  )}
                  {state !== "running" && <Chevron />}
                </div>
              );
            })}
            {frame.words > 0 && (
              <p>
                <Answer words={frame.words} />
              </p>
            )}
            {settled && <div className="meta">{`Worked for ${formatDuration(frame.t)}`}</div>}
          </div>

          <div className="composer">
            <div className="frame">
              <i>
                <AppIcon glyph={IconPlusSmall} size={17} />
              </i>
              <span className="ph">
                {settled ? "Plan, Build, / for skills, @ for context" : "Add a follow-up"}
              </span>
              <i className="send">
                <AppIcon glyph={IconArrowUp} size={15} />
              </i>
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}

function NavRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="nav">
      <span className="ic">{icon}</span>
      <span className="l">{children}</span>
    </div>
  );
}
