/**
 * Ways to show "a new Nyte is out" without a modal. One phase scrubber drives
 * every variant so the same moment can be compared across surfaces.
 *
 * Decisions so far: TUI uses the footer segment (A). Desktop is still open;
 * the constraint is subtle and no dialog, so the native message box is gone
 * from this board.
 */
import { create, props } from "@stylexjs/stylex";
import { useState, type ReactElement, type ReactNode } from "react";
import { avatar, radius } from "@nyte-ai/ui/schema.stylex";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { AccountRowStudies } from "./account-row";

const PHASES = ["available", "downloading", "ready", "blocked", "failed", "current"] as const;

type Phase = (typeof PHASES)[number];

const FROM = "0.2.0";

const TO = "0.3.0";

const PERCENT = 42;

const PHASE_LABEL: Readonly<Record<Phase, string>> = {
  available: "Available",
  downloading: "Downloading",
  ready: "Ready to restart",
  blocked: "Blocked (session busy)",
  failed: "Failed",
  current: "Up to date",
};

/** One sentence per phase, worded for a human. Variants trim it to fit. */
const COPY: Readonly<Record<Phase, { readonly short: string; readonly action?: string }>> = {
  available: { short: `Nyte ${TO} is available`, action: "Download" },
  downloading: { short: `Downloading ${TO}… ${String(PERCENT)}%` },
  ready: { short: `Nyte ${TO} is ready`, action: "Restart to update" },
  blocked: { short: `Restart when 2 tasks finish`, action: "Restart anyway" },
  failed: { short: "Couldn't update", action: "Retry" },
  current: { short: `Nyte ${FROM}` },
};

/* ------------------------------------------------------------------------ */
/* Desktop                                                                  */
/* ------------------------------------------------------------------------ */

function DesktopFrame({
  children,
  sidebarFooter,
  titlebarEnd,
  composerHint,
  hairline,
}: {
  readonly children?: ReactNode;
  readonly sidebarFooter?: ReactNode;
  readonly titlebarEnd?: ReactNode;
  readonly composerHint?: ReactNode;
  readonly hairline?: ReactNode;
}): ReactElement {
  return (
    <div {...props(styles.window)}>
      <div {...props(styles.titlebar)}>
        <span {...props(styles.lights)}>
          <i {...props(styles.light)} />
          <i {...props(styles.light)} />
          <i {...props(styles.light)} />
        </span>
        <span {...props(styles.titlebarTitle)}>nyte · packages/lab</span>
        <span {...props(styles.titlebarEnd)}>{titlebarEnd}</span>
      </div>
      {hairline}
      <div {...props(styles.body)}>
        <aside {...props(styles.sidebar)}>
          <div {...props(styles.sidebarRow, styles.sidebarRowActive)}>Update notice display</div>
          <div {...props(styles.sidebarRow)}>Review guide copy</div>
          <div {...props(styles.sidebarRow)}>Fix tar listing</div>
          <div {...props(styles.sidebarSpacer)} />
          {sidebarFooter}
        </aside>
        <main {...props(styles.content)}>
          {children}
          <div {...props(styles.composer)}>Ask anything…</div>
          <div {...props(styles.composerHint)}>{composerHint}</div>
        </main>
      </div>
    </div>
  );
}

function Dot({ tone }: { readonly tone: "accent" | "warn" | "muted" }): ReactElement {
  return <i {...props(styles.dot, styles[`dot_${tone}`])} aria-hidden />;
}

function toneFor(phase: Phase): "accent" | "warn" | "muted" {
  if (phase === "failed" || phase === "blocked") return "warn";

  if (phase === "current") return "muted";

  return "accent";
}

/** A. Sidebar footer row. Persistent, out of the way, where the account row already lives. */
function DesktopSidebarRow({ phase }: { readonly phase: Phase }): ReactElement {
  const copy = COPY[phase];

  return (
    <DesktopFrame
      sidebarFooter={
        <button {...props(styles.footerRow, phase === "current" && styles.footerRowQuiet)}>
          <Dot tone={toneFor(phase)} />
          <span {...props(styles.footerText)}>{copy.short}</span>
          {copy.action !== undefined && <span {...props(styles.footerAction)}>{copy.action}</span>}
          {phase === "downloading" && (
            <span {...props(styles.footerBar)}>
              <span {...props(styles.footerBarFill)} style={{ width: `${String(PERCENT)}%` }} />
            </span>
          )}
        </button>
      }
    />
  );
}

/** B. Titlebar badge. A dot on a version chip; the chip opens a popover with the action. */
function DesktopTitlebarBadge({ phase }: { readonly phase: Phase }): ReactElement {
  const [open, setOpen] = useState(phase !== "current");
  const copy = COPY[phase];

  return (
    <DesktopFrame
      titlebarEnd={
        <span {...props(styles.chipWrap)}>
          <button {...props(styles.chip)} onClick={() => setOpen((value) => !value)}>
            v{FROM}
            {phase !== "current" && <Dot tone={toneFor(phase)} />}
          </button>
          {open && phase !== "current" && (
            <div {...props(styles.popover)}>
              <div {...props(styles.popoverTitle)}>{copy.short}</div>
              <div {...props(styles.popoverDetail)}>
                {phase === "available" && `You're on ${FROM}. Download now, restart whenever.`}
                {phase === "downloading" && "Keep working. We'll tell you when it's ready."}
                {phase === "ready" && "Open sessions and terminals will close."}
                {phase === "blocked" && "Two tasks are still running in this window."}
                {phase === "failed" && "Your current install is untouched."}
              </div>
              {copy.action !== undefined && (
                <button {...props(styles.popoverButton)}>{copy.action}</button>
              )}
            </div>
          )}
        </span>
      }
    />
  );
}

/** C. Account row. The existing footer row gains a dot on the avatar; the menu it opens gets one item. */
function DesktopAccountRow({ phase }: { readonly phase: Phase }): ReactElement {
  const [open, setOpen] = useState(phase !== "current");
  const copy = COPY[phase];

  return (
    <DesktopFrame
      sidebarFooter={
        <span {...props(styles.chipWrap)}>
          {open && phase !== "current" && (
            <div {...props(styles.menu)}>
              <div {...props(styles.menuItem, styles.menuItemUpdate)}>
                <Dot tone={toneFor(phase)} />
                <span {...props(styles.footerText)}>{copy.short}</span>
                {copy.action !== undefined && (
                  <span {...props(styles.menuAction)}>{copy.action}</span>
                )}
              </div>
              <div {...props(styles.menuSeparator)} />
              <div {...props(styles.menuItem)}>Settings…</div>
              <div {...props(styles.menuItem)}>Sign out</div>
            </div>
          )}
          <button {...props(styles.accountRow)} onClick={() => setOpen((value) => !value)}>
            <span {...props(styles.avatarWrap)}>
              <span {...props(styles.avatar)}>W</span>
              {phase !== "current" && (
                <span {...props(styles.avatarBadge)}>
                  <Dot tone={toneFor(phase)} />
                </span>
              )}
            </span>
            <span {...props(styles.footerText)}>workgyver</span>
          </button>
        </span>
      }
    />
  );
}

/** D. Composer hint. One dim line under the input, like the TUI footer. */
function DesktopComposerHint({ phase }: { readonly phase: Phase }): ReactElement {
  const copy = COPY[phase];

  return (
    <DesktopFrame
      composerHint={
        <>
          <span>⏎ send · ⇧⏎ newline</span>
          {phase !== "current" && (
            <>
              <span {...props(styles.hintSeparator)}>·</span>
              <Dot tone={toneFor(phase)} />
              <span>{copy.short}</span>
              {copy.action !== undefined && (
                <button {...props(styles.hintAction)}>{copy.action}</button>
              )}
            </>
          )}
        </>
      }
    />
  );
}

/** E. Hairline. A 2px accent line under the titlebar; fills as progress, text only on hover. */
function DesktopHairline({ phase }: { readonly phase: Phase }): ReactElement {
  const [hover, setHover] = useState(false);
  const copy = COPY[phase];
  const width = phase === "downloading" ? PERCENT : phase === "available" ? 8 : 100;

  return (
    <DesktopFrame
      hairline={
        phase !== "current" && (
          <div
            {...props(styles.hairline)}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
          >
            <span
              {...props(styles.hairlineFill, toneFor(phase) === "warn" && styles.hairlineWarn)}
              style={{ width: `${String(width)}%` }}
            />
            {hover && (
              <span {...props(styles.hairlineLabel)}>
                {copy.short}
                {copy.action !== undefined && ` — ${copy.action}`}
              </span>
            )}
          </div>
        )
      }
    />
  );
}

/* ------------------------------------------------------------------------ */
/* TUI                                                                      */
/* ------------------------------------------------------------------------ */

function Term({
  rows,
  footer,
  prompt = "> ",
}: {
  readonly rows: readonly ReactNode[];
  readonly footer?: ReactNode;
  readonly prompt?: string;
}): ReactElement {
  return (
    <pre {...props(styles.term)}>
      {rows.map((row, index) => (
        <div key={index} {...props(styles.termRow)}>
          {row === "" ? "\u00a0" : row}
        </div>
      ))}
      <div {...props(styles.termRow)}>
        <span {...props(styles.dim)}>{prompt}</span>
        <span {...props(styles.cursor)}>▍</span>
      </div>
      <div {...props(styles.termFooter)}>{footer}</div>
    </pre>
  );
}

const dim = (text: string): ReactElement => <span {...props(styles.dim)}>{text}</span>;

const warn = (text: string): ReactElement => <span {...props(styles.warn)}>{text}</span>;

const accent = (text: string): ReactElement => <span {...props(styles.accentText)}>{text}</span>;

const HEADER = [
  <>
    <b>nyte</b> {dim(FROM)} {dim("· packages/lab · main")}
  </>,
  "",
];

/** A. Footer segment. Lives beside the hints; stays until acted on. */
function TuiFooter({ phase }: { readonly phase: Phase }): ReactElement {
  const segment: Readonly<Record<Phase, ReactNode>> = {
    available: accent(`↑ ${TO} available · /update`),
    downloading: accent(`↓ ${TO} ${"█".repeat(4)}${"░".repeat(6)} ${String(PERCENT)}%`),
    ready: accent(`↑ ${TO} installed · restart nyte`),
    blocked: warn(`↑ ${TO} installed · restart when idle`),
    failed: warn(`↑ ${TO} update failed · /update to retry`),
    current: undefined,
  };

  return (
    <Term
      rows={HEADER}
      footer={
        <>
          {dim("? help · ctrl-c quit")}
          {segment[phase] !== undefined && (
            <>
              {dim("  ·  ")}
              {segment[phase]}
            </>
          )}
        </>
      }
    />
  );
}

/** Reference: today's transient notice line that fades. */
function TuiCurrent({ phase }: { readonly phase: Phase }): ReactElement {
  const notice: Readonly<Record<Phase, ReactNode>> = {
    available: dim(`Update available: ${TO} · /update to install`),
    downloading: dim(`nyte ${FROM} → ${TO}  downloading ${String(PERCENT)}%`),
    ready: dim(`Updated nyte ${FROM} → ${TO} at ~/.local/bin/nyte. Restart nyte to use it.`),
    blocked: dim(`Updated nyte ${FROM} → ${TO} at ~/.local/bin/nyte. Restart nyte to use it.`),
    failed: warn(`Update available: ${TO} · Checksum mismatch for nyte-v${TO}-darwin-arm64.tar.gz`),
    current: undefined,
  };

  return (
    <Term
      rows={[...HEADER, notice[phase] ?? "", ""]}
      footer={dim("? help · ctrl-c quit  (notice fades after a few seconds)")}
    />
  );
}

/* ------------------------------------------------------------------------ */
/* Page                                                                     */
/* ------------------------------------------------------------------------ */

function Variant({
  name,
  note,
  children,
}: {
  readonly name: string;
  readonly note: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section {...props(styles.variant)}>
      <header {...props(styles.variantHeader)}>
        <h3 {...props(styles.variantName)}>{name}</h3>
        <p {...props(styles.variantNote)}>{note}</p>
      </header>
      {children}
    </section>
  );
}

export function UpdatesPage(): ReactElement {
  const [phase, setPhase] = useState<Phase>("available");

  return (
    <main {...props(styles.page)}>
      <div {...props(styles.column)}>
        <div {...props(styles.header)}>
          <h1 {...props(styles.title)}>Update notice</h1>
          <ToggleGroup
            aria-label="Phase"
            value={[phase]}
            onValueChange={(values) => {
              const last = values.at(-1);
              const next = PHASES.find((candidate) => candidate === last);

              if (next !== undefined) setPhase(next);
            }}
          >
            {PHASES.map((candidate) => (
              <Toggle key={candidate} value={candidate}>
                {PHASE_LABEL[candidate]}
              </Toggle>
            ))}
          </ToggleGroup>
        </div>

        <h2 {...props(styles.sectionTitle)}>Desktop</h2>
        <div {...props(styles.grid)}>
          <Variant
            name="A · Sidebar footer row"
            note="Persistent, where the account row already sits. Progress is the row itself."
          >
            <DesktopSidebarRow phase={phase} />
          </Variant>
          <Variant
            name="B · Titlebar badge"
            note="A dot on the version chip. Click for detail and the action. Quietest."
          >
            <DesktopTitlebarBadge phase={phase} />
          </Variant>
          <Variant
            name="C · Account row"
            note="A dot on the avatar you already see. The account menu carries the action."
          >
            <DesktopAccountRow phase={phase} />
          </Variant>
          <Variant
            name="D · Composer hint"
            note="Lives in the shortcut line under the input. Same shape as the TUI footer."
          >
            <DesktopComposerHint phase={phase} />
          </Variant>
          <Variant
            name="E · Hairline"
            note="2px under the titlebar. Doubles as the progress bar; hover for words."
          >
            <DesktopHairline phase={phase} />
          </Variant>
        </div>

        <h2 {...props(styles.sectionTitle)}>Desktop · C, deeper</h2>
        <AccountRowStudies />

        <h2 {...props(styles.sectionTitle)}>TUI</h2>
        <div {...props(styles.grid)}>
          <Variant
            name="A · Footer segment (picked)"
            note="Beside the hints. Persistent across turns, costs no rows."
          >
            <TuiFooter phase={phase} />
          </Variant>
          <Variant name="Reference · today" note="One notice that fades. Nothing persists.">
            <TuiCurrent phase={phase} />
          </Variant>
        </div>
      </div>
    </main>
  );
}

const styles = create({
  page: {
    height: "100%",
    overflowY: "auto",
    backgroundColor: role.bgBase,
    color: role.contentPrimary,
    fontFamily: type.fontSans,
  },
  column: {
    display: "flex",
    flexDirection: "column",
    gap: 24,
    maxWidth: 1280,
    marginInline: "auto",
    padding: "48px 32px 96px",
  },
  header: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  title: { margin: 0, fontSize: type.font2xl, fontWeight: 600, letterSpacing: type.letterLg },
  sectionTitle: {
    margin: 0,
    marginTop: 16,
    fontSize: type.fontLg,
    fontWeight: 600,
    color: role.contentSecondary,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(560px, 1fr))",
    gap: 24,
  },
  variant: { display: "flex", flexDirection: "column", gap: 10 },
  variantHeader: { display: "flex", flexDirection: "column", gap: 2 },
  variantName: { margin: 0, fontSize: type.fontBase, fontWeight: 600 },
  variantNote: { margin: 0, fontSize: type.fontSm, color: role.contentTertiary },

  /* desktop frame */
  window: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    height: 340,
    borderRadius: radius.card,
    overflow: "hidden",
    backgroundColor: role.bgBase,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
    fontSize: type.fontSm,
  },
  titlebar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    paddingBlock: 9,
    paddingInline: 12,
    lineHeight: "18px",
    backgroundColor: role.bgChrome,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondaryTranslucent,
  },
  lights: { display: "flex", gap: 6 },
  light: {
    display: "block",
    width: 10,
    height: 10,
    borderRadius: "50%",
    backgroundColor: role.bgControl,
  },
  titlebarTitle: { flex: 1, textAlign: "center", color: role.contentTertiary },
  titlebarEnd: { display: "flex", alignItems: "center", minWidth: 80, justifyContent: "flex-end" },
  body: { display: "flex", flex: 1, minHeight: 0 },
  sidebar: {
    display: "flex",
    flexDirection: "column",
    width: 200,
    padding: 8,
    gap: 2,
    backgroundColor: role.bgChrome,
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: role.borderSecondaryTranslucent,
  },
  sidebarRow: {
    paddingBlock: 6,
    paddingInline: 8,
    borderRadius: radius.control,
    color: role.contentSecondary,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  sidebarRowActive: { backgroundColor: role.bgControlSelected, color: role.contentPrimary },
  sidebarSpacer: { flex: 1 },
  content: { position: "relative", flex: 1, display: "flex", flexDirection: "column" },
  composer: {
    marginTop: "auto",
    margin: 16,
    padding: 10,
    borderRadius: radius.card,
    backgroundColor: role.bgMuted,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
    color: role.contentTertiary,
  },

  dot: { display: "inline-block", width: 7, height: 7, borderRadius: "50%", flexShrink: 0 },
  dot_accent: { backgroundColor: role.bgInteractivePrimary },
  dot_warn: { backgroundColor: "var(--nyte-content-warning, #d9822b)" },
  dot_muted: { backgroundColor: role.contentDisabled },

  /* A */
  footerRow: {
    display: "grid",
    gridTemplateColumns: "auto 1fr auto",
    alignItems: "center",
    columnGap: 8,
    width: "100%",
    paddingBlock: 6,
    paddingInline: 8,
    borderStyle: "none",
    borderRadius: radius.control,
    backgroundColor: { default: role.bgInteractivePrimaryTranslucent, ":hover": role.bgHover },
    textAlign: "left",
    cursor: "pointer",
  },
  footerRowQuiet: { backgroundColor: "transparent", color: role.contentTertiary },
  footerText: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  footerAction: { color: role.contentInteractivePrimary, fontWeight: 500 },
  footerBar: {
    gridColumn: "1 / -1",
    height: 3,
    marginTop: 4,
    borderRadius: 2,
    backgroundColor: role.bgControl,
    overflow: "hidden",
  },
  footerBarFill: { display: "block", height: "100%", backgroundColor: role.bgInteractivePrimary },

  /* B */
  chipWrap: { position: "relative" },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    paddingBlock: 2,
    paddingInline: 8,
    borderStyle: "none",
    borderRadius: radius.pill,
    backgroundColor: { default: role.bgControl, ":hover": role.bgControlHover },
    color: role.contentSecondary,
    fontSize: type.fontXs,
    fontFamily: type.fontMono,
    cursor: "pointer",
  },
  popover: {
    position: "absolute",
    top: "calc(100% + 6px)",
    right: 0,
    zIndex: 1,
    width: 240,
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    borderRadius: radius.card,
    backgroundColor: role.bgElevated,
    boxShadow: `0 0 0 1px ${role.borderSecondaryTranslucent}, 0 8px 24px rgb(0 0 0 / 0.18)`,
    textAlign: "left",
  },
  popoverTitle: { fontWeight: 600, color: role.contentPrimary },
  popoverDetail: { color: role.contentTertiary },
  popoverButton: {
    alignSelf: "flex-start",
    marginTop: 4,
    paddingBlock: 4,
    paddingInline: 10,
    borderStyle: "none",
    borderRadius: radius.control,
    backgroundColor: role.bgInteractivePrimary,
    color: role.contentOnInteractiveStrong,
    fontWeight: 500,
    cursor: "pointer",
  },

  /* C */
  accountRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    paddingBlock: 6,
    paddingInline: 8,
    borderStyle: "none",
    borderRadius: radius.control,
    backgroundColor: { default: "transparent", ":hover": role.bgHover },
    color: role.contentSecondary,
    textAlign: "left",
    cursor: "pointer",
  },
  avatarWrap: { position: "relative", display: "inline-flex" },
  avatar: {
    display: "inline-grid",
    placeItems: "center",
    width: avatar.xs,
    height: avatar.xs,
    borderRadius: "50%",
    backgroundColor: role.bgControl,
    fontSize: type.fontXs,
    fontWeight: 600,
  },
  avatarBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    display: "grid",
    placeItems: "center",
    padding: 2,
    borderRadius: "50%",
    backgroundColor: role.bgChrome,
  },
  menu: {
    position: "absolute",
    bottom: "calc(100% + 6px)",
    left: 0,
    zIndex: 1,
    width: 220,
    padding: 4,
    borderRadius: radius.card,
    backgroundColor: role.bgElevated,
    boxShadow: `0 0 0 1px ${role.borderSecondaryTranslucent}, 0 8px 24px rgb(0 0 0 / 0.18)`,
  },
  menuItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    paddingBlock: 6,
    paddingInline: 8,
    borderRadius: radius.control,
    color: role.contentPrimary,
  },
  menuItemUpdate: { backgroundColor: role.bgInteractivePrimaryTranslucent },
  menuAction: { marginLeft: "auto", color: role.contentInteractivePrimary, fontWeight: 500 },
  menuSeparator: {
    marginBlock: 4,
    marginInline: 8,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: role.borderSecondaryTranslucent,
  },

  /* D */
  composerHint: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginInline: 16,
    marginBottom: 10,
    marginTop: -8,
    paddingInline: 4,
    color: role.contentTertiary,
    fontSize: type.fontXs,
  },
  hintSeparator: { marginInline: 2 },
  hintAction: {
    padding: 0,
    borderStyle: "none",
    backgroundColor: "transparent",
    color: role.contentInteractivePrimary,
    fontSize: type.fontXs,
    fontWeight: 500,
    cursor: "pointer",
  },

  /* E */
  hairline: {
    position: "relative",
    height: 2,
    backgroundColor: role.bgControl,
    cursor: "default",
  },
  hairlineFill: {
    display: "block",
    height: "100%",
    backgroundColor: role.bgInteractivePrimary,
    transitionProperty: "width",
    transitionDuration: "300ms",
  },
  hairlineWarn: { backgroundColor: "var(--nyte-content-warning, #d9822b)" },
  hairlineLabel: {
    position: "absolute",
    top: 6,
    right: 12,
    zIndex: 1,
    paddingBlock: 2,
    paddingInline: 8,
    borderRadius: radius.pill,
    backgroundColor: role.bgElevated,
    boxShadow: `0 0 0 1px ${role.borderSecondaryTranslucent}`,
    color: role.contentSecondary,
    fontSize: type.fontXs,
    whiteSpace: "nowrap",
  },

  /* terminal */
  term: {
    display: "flex",
    flexDirection: "column",
    height: 340,
    margin: 0,
    padding: 14,
    borderRadius: radius.card,
    backgroundColor: "#111214",
    color: "#e6e6e6",
    fontFamily: type.fontMono,
    fontSize: 12.5,
    lineHeight: "20px",
    whiteSpace: "pre-wrap",
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
  },
  termRow: { lineHeight: "20px" },
  termFooter: { marginTop: "auto", paddingTop: 8 },
  dim: { color: "#7d8086" },
  warn: { color: "#e2b340" },
  accentText: { color: "#7cb2ff" },
  cursor: { color: "#e6e6e6", animationName: "none" },
});
