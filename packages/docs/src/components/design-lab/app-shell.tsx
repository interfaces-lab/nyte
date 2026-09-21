"use client";

import {
  IconArrowUp,
  IconCheckmark1Small,
  IconDotGrid1x3HorizontalTight,
  IconFolderOpen,
  IconMagnifyingGlass,
  IconPencil,
  IconPlusMedium,
  IconSettingsGear2,
  IconSidebar,
  IconTrashCan,
} from "central-icons-desktop";
import { AnimatePresence, motion } from "motion/react";
import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { MouseEvent, ReactElement } from "react";
import { composer, frame, pane, rail, thread } from "./shell.stylex";
import { dialog, menu, wax } from "./surfaces.stylex";

export type Surface = "none" | "popover" | "context" | "dialog" | "stacked";

const PRIMARY = [
  { id: "new", Glyph: IconPlusMedium, label: "New Chat", shortcut: "\u2318N" },
  { id: "search", Glyph: IconMagnifyingGlass, label: "Search", shortcut: "\u2318K" },
  { id: "customize", Glyph: IconSettingsGear2, label: "Customize", shortcut: "" },
] as const;

/*
 * One stroke weight per surface. Central Icons draw 1.5 units on a 24 grid;
 * at the 14px these render the desktop nudges that to 1.875 so the line reads
 * at the weight of the regular text beside it.
 */
const ICON = { size: 14, strokeWidth: 1.875 } as const;

/* Enter only, ease-out, short. Exit is softer than enter and never bounces. */
const SURFACE_MOTION = {
  initial: { opacity: 0, scale: 0.97, y: -2 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.98, y: -2 },
  transition: { type: "spring", duration: 0.3, bounce: 0 },
} as const;

const SESSIONS = [
  { id: "errors", label: "Preserve tool errors", meta: "now", state: "run" },
  { id: "scroll", label: "Scroll restore in tui", meta: "12m", state: "idle" },
  { id: "codec", label: "Protocol codec drift", meta: "1h", state: "fail" },
  { id: "panes", label: "Pane layout rewrite", meta: "3h", state: "idle" },
  { id: "codec2", label: "Composer latency", meta: "yst", state: "idle" },
] as const;

const MODELS = [
  { id: "opus", label: "Opus 5", key: "\u23181" },
  { id: "sonnet", label: "Sonnet 5", key: "\u23182" },
  { id: "haiku", label: "Haiku 4.5", key: "\u23183" },
] as const;

const DOT = { run: rail.dotRun, fail: rail.dotFail, idle: rail.dotIdle };

/**
 * One shell. The model popover, the session context menu and the confirm
 * dialog all take the same `wax.surface`: the material is a token, not a
 * per-component decision.
 */
export function AppShell({
  surface,
  onSurfaceChange,
}: {
  readonly surface: Surface;
  readonly onSurfaceChange: (next: Surface) => void;
}): ReactElement {
  const [model, setModel] = useState<string>("opus");
  const [session, setSession] = useState<string>("errors");
  const [anchor, setAnchor] = useState({ x: 150, y: 120 });

  const openContext = (event: MouseEvent<HTMLElement>): void => {
    event.preventDefault();
    const host = event.currentTarget.closest("[data-nds]")?.getBoundingClientRect();
    if (host) setAnchor({ x: event.clientX - host.left, y: event.clientY - host.top });
    onSurfaceChange("context");
  };

  const close = (): void => onSurfaceChange("none");

  return (
    <>
      <div {...stylex.props(frame.titlebar)}>
        <div {...stylex.props(frame.lights)}>
          <span {...stylex.props(frame.light, frame.lightClose)} />
          <span {...stylex.props(frame.light, frame.lightMin)} />
          <span {...stylex.props(frame.light, frame.lightMax)} />
        </div>
      </div>

      <div {...stylex.props(frame.body)}>
        <nav {...stylex.props(rail.root)}>
          <div {...stylex.props(rail.group)}>
            {PRIMARY.map((item) => (
              <button key={item.id} type="button" {...stylex.props(rail.row)}>
                <span {...stylex.props(rail.glyph)}>
                  <item.Glyph {...ICON} />
                </span>
                <span {...stylex.props(rail.label)}>{item.label}</span>
                <span {...stylex.props(rail.shortcut)}>{item.shortcut}</span>
              </button>
            ))}
          </div>

          <div {...stylex.props(rail.scroll)}>
            <p {...stylex.props(rail.heading)}>
              nyte
              <button
                type="button"
                aria-label="New chat here"
                {...stylex.props(rail.headingAction)}
              >
                <IconPlusMedium {...ICON} />
              </button>
            </p>
            <div {...stylex.props(rail.group)}>
              {SESSIONS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  {...stylex.props(rail.row, session === item.id && rail.rowActive)}
                  onClick={() => setSession(item.id)}
                  onContextMenu={openContext}
                >
                  <span {...stylex.props(rail.glyph)}>
                    <span {...stylex.props(rail.dot, DOT[item.state])} />
                  </span>
                  <span {...stylex.props(rail.label)}>{item.label}</span>
                  <span {...stylex.props(rail.meta)}>{item.meta}</span>
                </button>
              ))}
            </div>
          </div>

          <div {...stylex.props(rail.group, rail.account)}>
            <button type="button" {...stylex.props(rail.row)}>
              <span {...stylex.props(rail.glyph)}>
                <span {...stylex.props(rail.avatar)}>DF</span>
              </span>
              <span {...stylex.props(rail.label)}>daniel</span>
            </button>
          </div>
        </nav>

        <section {...stylex.props(pane.root)}>
          <header {...stylex.props(pane.header)}>
            <span {...stylex.props(pane.title)}>Preserve tool errors</span>
            <span {...stylex.props(pane.actions)}>
              <button type="button" aria-label="Split pane" {...stylex.props(pane.iconButton)}>
                <IconSidebar {...ICON} />
              </button>
              <button
                type="button"
                aria-label="Pane actions"
                {...stylex.props(pane.iconButton)}
                onClick={() => {
                  setAnchor({ x: 470, y: 46 });
                  onSurfaceChange(surface === "context" ? "none" : "context");
                }}
              >
                <IconDotGrid1x3HorizontalTight {...ICON} />
              </button>
            </span>
          </header>

          <div {...stylex.props(pane.body)}>
            <div {...stylex.props(pane.conversation)}>
              <div {...stylex.props(thread.scroll)}>
                <div {...stylex.props(thread.measure)}>
                  <div {...stylex.props(thread.userPrompt)}>
                    Why does the transcript drop the tool error text?
                  </div>

                  <div {...stylex.props(thread.turn)}>
                    <p {...stylex.props(thread.para)}>
                      The renderer keeps the exit code and discards <code>stderr</code>. Reading the
                      call site now.
                    </p>
                    <div {...stylex.props(thread.technical)}>
                      read · packages/core/src/tool-result.ts
                      <span {...stylex.props(thread.ok)}>ok</span>
                    </div>
                    <div {...stylex.props(thread.diff)}>
                      <div {...stylex.props(thread.diffHeader)}>
                        packages/core/src/tool-result.ts
                        <span {...stylex.props(thread.diffStat)}>
                          <span {...stylex.props(thread.statAdd)}>+1</span>
                          <span {...stylex.props(thread.statDel)}>−1</span>
                        </span>
                      </div>
                      <div {...stylex.props(thread.diffLine, thread.diffDel)}>
                        {"- return { ok: false, code };"}
                      </div>
                      <div {...stylex.props(thread.diffLine, thread.diffAdd)}>
                        {"+ return { ok: false, code, stderr };"}
                      </div>
                    </div>
                    <p {...stylex.props(thread.para)}>
                      Two call sites construct the result. Both drop the stream before it reaches
                      the transcript, so the fix belongs in the constructor rather than the view.
                    </p>
                  </div>

                  <div {...stylex.props(thread.userPrompt)}>
                    Fix both, and make sure the TUI renders it too.
                  </div>

                  <div {...stylex.props(thread.turn)}>
                    <p {...stylex.props(thread.thinking)}>
                      Thought for 4s · two constructors, one renderer
                    </p>
                    <p {...stylex.props(thread.para)}>
                      The desktop reads <code>result.stderr</code> already, so only the protocol
                      type and the TUI transcript need touching.
                    </p>
                    <div {...stylex.props(thread.technical)}>
                      grep · &quot;ok: false&quot; packages
                      <span {...stylex.props(thread.ok)}>4 files</span>
                    </div>
                    <div {...stylex.props(thread.diff)}>
                      <div {...stylex.props(thread.diffHeader)}>
                        packages/protocol/src/tool.ts
                        <span {...stylex.props(thread.diffStat)}>
                          <span {...stylex.props(thread.statAdd)}>+2</span>
                        </span>
                      </div>
                      <div {...stylex.props(thread.diffLine, thread.diffAdd)}>
                        {"+  /** Captured when the tool writes to stderr. */"}
                      </div>
                      <div {...stylex.props(thread.diffLine, thread.diffAdd)}>
                        {"+  readonly stderr?: string;"}
                      </div>
                    </div>
                    <div {...stylex.props(thread.diff)}>
                      <div {...stylex.props(thread.diffHeader)}>
                        packages/tui/src/transcript.ts
                        <span {...stylex.props(thread.diffStat)}>
                          <span {...stylex.props(thread.statAdd)}>+6</span>
                          <span {...stylex.props(thread.statDel)}>−2</span>
                        </span>
                      </div>
                      <div {...stylex.props(thread.diffLine, thread.diffDel)}>
                        {"-  if (!result.ok) return dim(`exit ${result.code}`);"}
                      </div>
                      <div {...stylex.props(thread.diffLine, thread.diffAdd)}>
                        {"+  if (!result.ok) {"}
                      </div>
                      <div {...stylex.props(thread.diffLine, thread.diffAdd)}>
                        {"+    const detail = result.stderr?.trimEnd();"}
                      </div>
                      <div {...stylex.props(thread.diffLine, thread.diffAdd)}>
                        {"+    return detail ? red(detail) : dim(`exit ${result.code}`);"}
                      </div>
                      <div {...stylex.props(thread.diffLine, thread.diffAdd)}>{"+  }"}</div>
                    </div>
                    <div {...stylex.props(thread.technical)}>
                      bash · pnpm --dir packages/core test
                      <span {...stylex.props(thread.ok)}>42 passed</span>
                    </div>
                    <div {...stylex.props(thread.changesCard)}>
                      <div {...stylex.props(thread.changesHead)}>
                        3 files changed
                        <span {...stylex.props(thread.diffStat)}>
                          <span {...stylex.props(thread.statAdd)}>+9</span>
                          <span {...stylex.props(thread.statDel)}>−3</span>
                        </span>
                      </div>
                      <div {...stylex.props(thread.changesRow)}>
                        <span {...stylex.props(thread.changesName)}>core/src/tool-result.ts</span>
                        <span {...stylex.props(thread.statAdd)}>+1</span>
                        <span {...stylex.props(thread.statDel)}>−1</span>
                      </div>
                      <div {...stylex.props(thread.changesRow)}>
                        <span {...stylex.props(thread.changesName)}>protocol/src/tool.ts</span>
                        <span {...stylex.props(thread.statAdd)}>+2</span>
                      </div>
                      <div {...stylex.props(thread.changesRow)}>
                        <span {...stylex.props(thread.changesName)}>tui/src/transcript.ts</span>
                        <span {...stylex.props(thread.statAdd)}>+6</span>
                        <span {...stylex.props(thread.statDel)}>−2</span>
                      </div>
                    </div>
                    <p {...stylex.props(thread.para)}>
                      Both hosts now print the captured stream and fall back to the exit code when
                      it is empty.
                    </p>
                  </div>

                  <div {...stylex.props(thread.userPrompt)}>
                    Add a test for the empty-stderr fallback.
                  </div>

                  <div {...stylex.props(thread.turn)}>
                    <div {...stylex.props(thread.working)}>
                      Writing packages/tui/src/transcript.test.ts
                      <span {...stylex.props(thread.caret)} />
                    </div>
                  </div>
                </div>
              </div>

              <div {...stylex.props(composer.dock)}>
                <div {...stylex.props(composer.frame)}>
                  Ask anything, or drop a file…
                  <div {...stylex.props(composer.footer)}>
                    <span {...stylex.props(composer.chip)}>@tool-result.ts</span>
                    <button
                      type="button"
                      {...stylex.props(composer.pill)}
                      onClick={() => onSurfaceChange(surface === "popover" ? "none" : "popover")}
                    >
                      {MODELS.find((entry) => entry.id === model)?.label} {"\u2303"}
                    </button>
                    <button type="button" aria-label="Send" {...stylex.props(composer.send)}>
                      <IconArrowUp {...ICON} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      {surface !== "none" && surface !== "dialog" && surface !== "stacked" && (
        <button
          type="button"
          aria-label="Dismiss"
          {...stylex.props(menu.catcher)}
          onClick={close}
        />
      )}

      <AnimatePresence initial={false}>
        {surface === "popover" && (
          <motion.div
            key="popover"
            {...SURFACE_MOTION}
            {...stylex.props(wax.surface, wax.clipped, menu.popup)}
            style={{ right: 26, bottom: 72, transformOrigin: "bottom right" }}
          >
            <p {...stylex.props(menu.group)}>Model</p>
            {MODELS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                {...stylex.props(menu.item, model === entry.id && menu.itemSelected)}
                onClick={() => {
                  setModel(entry.id);
                  close();
                }}
              >
                <span {...stylex.props(menu.check)}>
                  {model === entry.id && <IconCheckmark1Small {...ICON} />}
                </span>
                {entry.label}
                <span {...stylex.props(menu.key)}>{entry.key}</span>
              </button>
            ))}
            <div {...stylex.props(menu.separator)} />
            <p {...stylex.props(menu.group)}>Thinking</p>
            <button type="button" {...stylex.props(menu.item)}>
              <span {...stylex.props(menu.check)} />
              High
            </button>
            <button type="button" {...stylex.props(menu.item)}>
              <span {...stylex.props(menu.check)} />
              Max
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {(surface === "context" || surface === "stacked") && (
          <motion.div
            key="context"
            {...SURFACE_MOTION}
            {...stylex.props(wax.surface, wax.clipped, menu.popup)}
            style={{ left: anchor.x, top: anchor.y, transformOrigin: "top left" }}
          >
            <button type="button" {...stylex.props(menu.item)} onClick={close}>
              <span {...stylex.props(menu.check)}>
                <IconPencil {...ICON} />
              </span>
              Rename<span {...stylex.props(menu.key)}>{"\u23CE"}</span>
            </button>
            <button type="button" {...stylex.props(menu.item)} onClick={close}>
              <span {...stylex.props(menu.check)}>
                <IconPlusMedium {...ICON} />
              </span>
              Duplicate<span {...stylex.props(menu.key)}>{"\u2318D"}</span>
            </button>
            <button type="button" {...stylex.props(menu.item, menu.itemSelected)}>
              <span {...stylex.props(menu.check)}>
                <IconFolderOpen {...ICON} />
              </span>
              Reveal in
              <span {...stylex.props(menu.chevron)}>{"\u203A"}</span>
            </button>
            <div {...stylex.props(menu.separator)} />
            <button
              type="button"
              {...stylex.props(menu.item, menu.itemDanger)}
              onClick={() => onSurfaceChange("dialog")}
            >
              <span {...stylex.props(menu.check)}>
                <IconTrashCan {...ICON} />
              </span>
              Delete<span {...stylex.props(menu.key)}>{"\u2326"}</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* The submenu is the second layer: wax on wax, both over the transcript. */}
      <AnimatePresence initial={false}>
        {(surface === "context" || surface === "stacked") && (
          <motion.div
            key="submenu"
            {...SURFACE_MOTION}
            {...stylex.props(wax.surface, wax.clipped, menu.popup, menu.submenu)}
            style={{
              left: anchor.x + 186,
              top: anchor.y + 52,
              transformOrigin: "top left",
            }}
          >
            <button type="button" {...stylex.props(menu.item)} onClick={close}>
              <span {...stylex.props(menu.check)} />
              Finder
            </button>
            <button type="button" {...stylex.props(menu.item)} onClick={close}>
              <span {...stylex.props(menu.check)} />
              Terminal
            </button>
            <button type="button" {...stylex.props(menu.item)} onClick={close}>
              <span {...stylex.props(menu.check)} />
              GitHub
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {(surface === "dialog" || surface === "stacked") && (
          <motion.div
            key="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
            {...stylex.props(dialog.scrim)}
            onClick={close}
          >
            <motion.div
              {...SURFACE_MOTION}
              {...stylex.props(wax.surface, dialog.panel)}
              onClick={(event) => event.stopPropagation()}
            >
              <h2 {...stylex.props(dialog.title)}>Delete this session?</h2>
              <p {...stylex.props(dialog.body)}>
                The transcript and any uncommitted changes in its worktree are removed. This cannot
                be undone.
              </p>
              <div {...stylex.props(dialog.actions)}>
                <button type="button" {...stylex.props(dialog.button)} onClick={close}>
                  Cancel
                </button>
                <button
                  type="button"
                  {...stylex.props(dialog.button, dialog.buttonDanger)}
                  onClick={close}
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
