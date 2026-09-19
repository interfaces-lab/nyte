import {
  IconArchive1,
  IconArrowLeft,
  IconArrowRight,
  IconArrowUp,
  IconBlocks,
  IconBubbleQuestion,
  IconChevronDownMedium,
  IconChevronLeftMedium,
  IconChevronRightMedium,
  IconCloudSimple,
  IconCollaborationPointerRight,
  IconDotGrid1x3HorizontalTight,
  IconDotGrid1x3VerticalTight,
  IconFolderOpen,
  IconMagnifyingGlass,
  IconPin,
  IconPlusMedium,
  IconPlusSmall,
  IconSettingsGear2,
  IconUser,
} from "central-icons-desktop";
import type { ReactNode } from "react";

/*
 * The three hosts, drawn at their real pixel geometry and scaled down, so the
 * card shows the product rather than a sketch of it. Every colour and every
 * number below is lifted from the app it belongs to, dark appearance:
 *
 *   desktop  desktop/src/renderer/src/theme/tokens.css, chrome/sidebar.stylex.ts,
 *            chrome/titlebar.tsx, screens/thread.tsx, conversation/styles.stylex.ts
 *   mobile   ui/src/platform-colors.ts (dark) through mobile/src/theme.ts, plus
 *            mobile/src/chat/{messages,composer,composer-geometry,chat-screen}
 *   tui      tui/src/theme.ts (DARK_THEME), constants.ts (GLYPHS, labels),
 *            app/App.tsx and app/ui.ts (prompt, powerline, hint row)
 *
 * One session — the same turn — in all three.
 *
 * The glyphs are the desktop's own icon family, `central-icons-desktop`
 * (round-outlined-radius-2-stroke-1.5), at the size each call site asks for in
 * desktop/src/renderer/src/components/icons.tsx. Mobile draws SF Symbols, which
 * have no npm equivalent, so those slots take the same family by symbol name.
 */

const BASE = "#fcfcfc";

/** `color-mix(in srgb, var(--nyte-base) N%, transparent)`, the derived ramp. */
const step = (percent: number): string => `color-mix(in srgb, ${BASE} ${percent}%, transparent)`;

const desktop = {
  chrome: "#111111",
  editor: "#141414",
  sidebar: "#141414",
  accent: "#1084fe",
  textPrimary: BASE,
  textSecondary: step(74),
  textTertiary: step(60),
  textQuaternary: step(36),
  iconSecondary: step(66),
  iconTertiary: step(52),
  bgSecondary: step(14),
  fillGhostHover: step(8),
  fillGhostSelected: step(6),
  fillSecondary: step(4),
  strokePrimary: step(20),
  strokeSecondary: step(12),
  strokeTertiary: step(8),
  strokeQuaternary: step(4),
  textAccent: "#459ffe",
  textSuccess: "#38d591",
  textDanger: "#ff5667",
  technicalBg: "#f0f0f007",
  technicalRing: "#f0f0f01c",
  guide: "#f0f0f026",
  diffAddedLine: "oklch(0.638 0.129 153.739 / 0.2)",
  diffRemovedLine: "oklch(0.5 0.2 9.842 / 0.2)",
  userShell: "color-mix(in srgb, #141414 60%, transparent)",
  userPrompt: "color-mix(in srgb, #141414 90%, #141414)",
  composerBg: "color-mix(in srgb, #141414 96%, #fff)",
  fillPrimary: BASE,
  textInvert: "#141414",
  sans: '"Inter", "Inter Variable", system-ui, -apple-system, sans-serif',
  mono: 'ui-monospace, Menlo, "DejaVu Sans Mono", Consolas, monospace',
} as const;

const mobile = {
  canvas: "#141414",
  surface: "#262626",
  raised: "#2f2f2f",
  fill: "#7777772b",
  foreground: "#fcfcfc",
  muted: "#fcfcfc99",
  tertiary: "#fcfcfc5c",
  border: "#fcfcfc14",
  accent: "#459ffe",
  success: "#38d591",
  danger: "#ff5667",
  sans: '-apple-system, "SF Pro Text", system-ui, sans-serif',
} as const;

const tui = {
  terminal: "#171717",
  background: "#0a0a0a",
  codeBackground: "#171717",
  foreground: "#fafafa",
  dim: "#737373",
  muted: "#525252",
  accent: "#009fff",
  user: "#d4d4d4",
  thinking: "#9d6afb",
  tool: "#a3a3a3",
  ok: "#07c480",
  running: "#08c0ef",
  path: "#ffa359",
  promptBorder: "#2c2c2c",
  promptBorderFocused: "#525252",
  userBackground: "#1d1d1d",
  scrollbarTrack: "#101010",
  scrollbarThumb: "#262626",
  mono: 'ui-monospace, "SF Mono", Menlo, "DejaVu Sans Mono", monospace',
} as const;

function Frame({
  width,
  height,
  scale,
  radius,
  background,
  children,
}: {
  width: number;
  height: number;
  scale: number;
  radius: number;
  background: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        width: width * scale,
        height: height * scale,
        overflow: "hidden",
        borderRadius: radius * scale,
        background,
        boxShadow: "0 18px 40px rgb(0 0 0 / 22%)",
      }}
    >
      <div
        style={{
          width,
          height,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          textRendering: "geometricPrecision",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Central Icons stroke 1.5 on a 24 grid, too thin at the 10–16px these rows
 * ask for; desktop/src/renderer/src/theme/global.css thickens every one of
 * them. Same rule, same hook, and it stands in for the weight SF Symbols
 * carry on the phone.
 */
const ICON_STROKE_RULE = '[data-nyte-icon] svg [stroke]:not([stroke="none"]){stroke-width:1.875}';

/**
 * The one glyph the icon set does not carry: components/icons.tsx draws the
 * panel toggle itself so the divider can move between the two states.
 */
const PANEL_FRAME_PATH =
  "M3 8C3 6.34 4.34 5 6 5H18C19.66 5 21 6.34 21 8V16C21 17.66 19.66 19 18 19H6C4.34 19 3 17.66 3 16V8Z";
const PANEL_DIVIDER_X = {
  left: { visible: 9, hidden: 7 },
  right: { visible: 15, hidden: 17 },
} as const;

function PanelToggleIcon({
  side,
  visible,
  color,
}: {
  side: "left" | "right";
  visible: boolean;
  color: string;
}) {
  const x = PANEL_DIVIDER_X[side][visible ? "visible" : "hidden"];
  return (
    <svg viewBox="0 0 24 24" width={15} height={15} fill="none" style={{ display: "block" }}>
      <path d={PANEL_FRAME_PATH} stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
      <path
        d={visible ? `M${String(x)} 5V12V19` : `M${String(x)} 9V12V15`}
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap={visible ? undefined : "round"}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/*
 * The sidebar's working mark: a 4×4 grid of 3px squares at a 4px pitch in a
 * 15px box, corners dropped, edges dimmed. (components/spinner.tsx)
 */
const SPINNER_EDGE = new Set([1, 2, 4, 7, 8, 11, 13, 14]);
const SPINNER_SQUARES = [1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14];

function Spinner({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 15 15" width={15} height={15} fill={color} style={{ display: "block" }}>
      {SPINNER_SQUARES.map((index) => (
        <rect
          key={index}
          x={(index % 4) * 4}
          y={Math.floor(index / 4) * 4}
          width="3"
          height="3"
          rx="1"
          opacity={SPINNER_EDGE.has(index) ? 0.25 : 0.7}
        />
      ))}
    </svg>
  );
}

/* ── desktop ─────────────────────────────────────────────────────────────── */

const TRAFFIC_LIGHTS = ["#ff5f57", "#febc2e", "#28c840"];

function NavRow({
  label,
  glyph,
  shortcut,
}: {
  label: string;
  glyph: ReactNode;
  shortcut?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        height: 28,
        paddingInline: 4,
        borderRadius: 8,
        color: desktop.textSecondary,
        fontSize: 13,
        lineHeight: "22px",
      }}
    >
      <span style={{ display: "grid", placeItems: "center", width: 20, height: 20 }}>{glyph}</span>
      <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
      {shortcut !== undefined && (
        <span
          style={{
            minWidth: 44,
            textAlign: "right",
            color: desktop.textQuaternary,
            fontSize: 11,
            lineHeight: "14px",
          }}
        >
          {shortcut}
        </span>
      )}
    </div>
  );
}

function SessionRow({
  title,
  meta,
  mark,
  state = "rest",
}: {
  title: string;
  meta: string;
  mark: ReactNode;
  state?: "rest" | "hover" | "selected";
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        height: 28,
        paddingInline: 4,
        borderRadius: 6,
        background:
          state === "selected"
            ? desktop.fillGhostSelected
            : state === "hover"
              ? desktop.fillGhostHover
              : "transparent",
        color: state === "selected" ? desktop.textPrimary : desktop.textSecondary,
        fontSize: 13,
        lineHeight: "22px",
      }}
    >
      <span style={{ display: "grid", placeItems: "center", width: 20, height: 20 }}>{mark}</span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {title}
      </span>
      {state === "hover" && (
        <span style={{ display: "inline-flex", gap: 2, width: 44, justifyContent: "flex-end" }}>
          <IconPin size={12} color={desktop.iconTertiary} mode="raw" />
          <IconArchive1 size={12} color={desktop.iconTertiary} mode="raw" />
        </span>
      )}
      <span
        style={{
          minWidth: 40,
          textAlign: "right",
          color: state === "selected" ? desktop.textSecondary : desktop.textTertiary,
          fontSize: 11,
          lineHeight: "14px",
          letterSpacing: 0.07,
        }}
      >
        {meta}
      </span>
    </div>
  );
}

function GroupLabel({ label }: { label: string }) {
  return (
    <div
      style={{
        minHeight: 28,
        paddingInlineStart: 30,
        paddingInlineEnd: 4,
        paddingBlock: 4,
        color: desktop.textTertiary,
        fontSize: 11,
        lineHeight: "14px",
      }}
    >
      {label}
    </div>
  );
}

function ToolLine({
  verb,
  detail,
  added,
  removed,
}: {
  verb: string;
  detail: string;
  added?: number;
  removed?: number;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        minHeight: 24,
        fontSize: 15,
        lineHeight: "24px",
        letterSpacing: "-0.24px",
      }}
    >
      <span style={{ color: desktop.textSecondary }}>{verb}</span>
      <span style={{ color: desktop.textTertiary }}>{detail}</span>
      {added !== undefined && (
        <span style={{ display: "inline-flex", gap: 6, marginInlineStart: 4 }}>
          <span style={{ color: desktop.textSuccess }}>+{added}</span>
          <span style={{ color: desktop.textDanger }}>-{removed}</span>
        </span>
      )}
      <IconChevronRightMedium size={12} color={desktop.iconTertiary} mode="raw" />
    </div>
  );
}

/** `--diffs-line-height: 20px` on `--nyte-font-size-code: 12px`, four-digit gutter. */
function DiffRow({ sign, number, code }: { sign: " " | "+" | "-"; number: string; code: string }) {
  const tint =
    sign === "+" ? desktop.diffAddedLine : sign === "-" ? desktop.diffRemovedLine : "transparent";
  const signColor =
    sign === "+" ? "#00c972" : sign === "-" ? desktop.textDanger : desktop.textTertiary;
  return (
    <div style={{ display: "flex", background: tint, height: 20, alignItems: "center" }}>
      <span
        style={{
          minWidth: "calc(4ch + 8px)",
          paddingInlineEnd: 8,
          textAlign: "right",
          color: desktop.textTertiary,
        }}
      >
        {number}
      </span>
      <span style={{ width: "2ch", color: signColor }}>{sign}</span>
      <span style={{ color: desktop.textPrimary, whiteSpace: "pre" }}>{code}</span>
    </div>
  );
}

/** turnStyles.userRow → userPromptShell → userPrompt, sticky prompt geometry. */
function UserTurn({ text, first = false }: { text: string; first?: boolean }) {
  return (
    <div style={{ paddingInline: 16, paddingTop: first ? 0 : 14 }}>
      <div style={{ paddingTop: 10, marginBottom: 4 }}>
        <div style={{ borderRadius: 12, background: desktop.userShell }}>
          <div
            style={{
              padding: "8px 10px",
              border: `1px solid ${desktop.strokeTertiary}`,
              borderRadius: 12,
              background: desktop.userPrompt,
              fontSize: 15,
              lineHeight: "24px",
              letterSpacing: "-0.24px",
            }}
          >
            {text}
          </div>
        </div>
      </div>
    </div>
  );
}

function Prose({ children }: { children: ReactNode }) {
  return (
    <div style={{ maxWidth: 840, fontSize: 15, lineHeight: "24px", letterSpacing: "-0.24px" }}>
      {children}
    </div>
  );
}

export function DesktopMock({ scale = 0.46 }: { scale?: number }) {
  return (
    <Frame width={1040} height={660} scale={scale} radius={12} background={desktop.sidebar}>
      <style href="nyte-mock-icon-stroke" precedence="default">
        {ICON_STROKE_RULE}
      </style>
      <div
        data-nyte-icon=""
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          background: desktop.sidebar,
          color: desktop.textPrimary,
          fontFamily: desktop.sans,
          fontSize: 13,
          lineHeight: "22px",
          letterSpacing: 0,
        }}
      >
        {/* titlebar: 35px, 72px traffic-light lane, content fill from sidebar edge */}
        <header
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            height: 35,
            paddingInlineStart: 72,
            paddingInlineEnd: 10,
            flexShrink: 0,
          }}
        >
          <span
            style={{
              position: "absolute",
              insetBlock: 0,
              insetInlineStart: 219,
              insetInlineEnd: 0,
              borderInlineStart: `1px solid ${desktop.strokeQuaternary}`,
              background: desktop.chrome,
            }}
          />
          <span
            style={{ position: "absolute", insetInlineStart: 20, top: 11, display: "flex", gap: 8 }}
          >
            {TRAFFIC_LIGHTS.map((light) => (
              <span
                key={light}
                style={{ width: 12, height: 12, borderRadius: 12, background: light }}
              />
            ))}
          </span>
          <span style={{ display: "grid", placeItems: "center", width: 28, height: 28, zIndex: 1 }}>
            <PanelToggleIcon side="left" visible color={desktop.iconSecondary} />
          </span>
          <span
            style={{
              position: "absolute",
              insetInlineStart: 156,
              insetBlock: 0,
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
              zIndex: 2,
            }}
          >
            <span style={{ display: "grid", placeItems: "center", width: 28, height: 28 }}>
              <IconArrowLeft size={16} color={desktop.iconSecondary} mode="raw" />
            </span>
            <span style={{ display: "grid", placeItems: "center", width: 28, height: 28 }}>
              <IconArrowRight size={16} color={desktop.textQuaternary} mode="raw" />
            </span>
          </span>
          <span
            style={{
              position: "absolute",
              insetBlock: 0,
              insetInlineStart: 232,
              insetInlineEnd: 96,
              display: "flex",
              alignItems: "center",
              zIndex: 1,
              color: desktop.textSecondary,
              fontSize: 12,
              lineHeight: "16px",
            }}
          >
            Release notes for 0.5.0
          </span>
          <span
            style={{
              marginInlineStart: "auto",
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
              zIndex: 3,
            }}
          >
            <span style={{ display: "grid", placeItems: "center", width: 28, height: 28 }}>
              <IconDotGrid1x3VerticalTight size={16} color={desktop.iconSecondary} mode="raw" />
            </span>
            <span style={{ display: "grid", placeItems: "center", width: 28, height: 28 }}>
              <PanelToggleIcon side="right" visible={false} color={desktop.iconSecondary} />
            </span>
          </span>
        </header>

        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {/* rail: 220px, 8px gutter, 28px rows */}
          <aside
            style={{
              position: "relative",
              display: "flex",
              flexDirection: "column",
              width: 220,
              minHeight: 0,
              flexShrink: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 1,
                paddingInline: 8,
                paddingBlockStart: 6,
              }}
            >
              <NavRow
                label="New Chat"
                shortcut="⌘N"
                glyph={
                  <IconCollaborationPointerRight
                    size={14}
                    color={desktop.iconSecondary}
                    mode="raw"
                  />
                }
              />
              <NavRow
                label="Search"
                glyph={<IconMagnifyingGlass size={14} color={desktop.iconSecondary} mode="raw" />}
              />
              <NavRow
                label="Customize"
                glyph={<IconBlocks size={14} color={desktop.iconSecondary} mode="raw" />}
              />
              <NavRow
                label="Cloud"
                glyph={<IconCloudSimple size={14} color={desktop.iconSecondary} mode="raw" />}
              />
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                flex: 1,
                minHeight: 0,
                gap: 8,
                paddingInline: 8,
                paddingBlock: 8,
                overflow: "hidden",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    height: 28,
                    paddingInlineStart: 4,
                    paddingInlineEnd: 4,
                    color: desktop.textTertiary,
                    fontSize: 13,
                  }}
                >
                  <span>Workspaces</span>
                  <span style={{ display: "inline-flex", transform: "rotate(90deg)" }}>
                    <IconChevronRightMedium size={11} color={desktop.iconTertiary} mode="raw" />
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    height: 28,
                    paddingInline: 4,
                    color: desktop.textSecondary,
                  }}
                >
                  <span style={{ display: "grid", placeItems: "center", width: 20, height: 20 }}>
                    <IconFolderOpen size={14} color={desktop.iconTertiary} mode="raw" />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>nyte</span>
                  <span style={{ display: "grid", placeItems: "center", width: 24, height: 24 }}>
                    <IconPlusMedium size={13} color={desktop.iconTertiary} mode="raw" />
                  </span>
                </div>
                <GroupLabel label="Past day" />
                <SessionRow
                  title="Release notes for 0.5.0"
                  meta="now"
                  state="selected"
                  mark={<Spinner color={desktop.textAccent} />}
                />
                <SessionRow
                  title="Sidebar drag targets"
                  meta="12m"
                  state="hover"
                  mark={
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 8,
                        background: desktop.textAccent,
                      }}
                    />
                  }
                />
                <SessionRow
                  title="Composer latency trace"
                  meta="1h"
                  mark={<IconBubbleQuestion size={14} color="#ffaf38" mode="raw" />}
                />
                <SessionRow title="Snapshot event floor" meta="3h" mark={null} />
                <GroupLabel label="Past week" />
                <SessionRow title="Protocol compare-and-swap" meta="Tue" mark={null} />
                <SessionRow title="Mobile review strip" meta="Sep 30" mark={null} />
              </div>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 2,
                paddingInline: 8,
                paddingBlock: 8,
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  flex: 1,
                  height: 28,
                  paddingInline: 4,
                  borderRadius: 8,
                  color: desktop.textSecondary,
                }}
              >
                <span style={{ display: "grid", placeItems: "center", width: 20, height: 20 }}>
                  <IconUser size={14} color={desktop.iconSecondary} mode="raw" />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>Nyte</span>
              </div>
              <span style={{ display: "grid", placeItems: "center", width: 28, height: 28 }}>
                <IconSettingsGear2 size={14} color={desktop.iconTertiary} mode="raw" />
              </span>
            </div>
            <span
              style={{
                position: "absolute",
                insetBlock: 0,
                insetInlineEnd: 0,
                width: 1,
                background: desktop.strokeQuaternary,
              }}
            />
          </aside>

          <main
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              background: desktop.chrome,
              overflow: "hidden",
            }}
          >
            {/* conversation header: 35px */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                height: 35,
                paddingInline: 12,
                flexShrink: 0,
              }}
            >
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600 }}>
                Release notes for 0.5.0
              </span>
              <span style={{ display: "inline-flex", gap: 2 }}>
                <span style={{ display: "grid", placeItems: "center", width: 28, height: 28 }}>
                  <IconDotGrid1x3VerticalTight size={16} color={desktop.iconTertiary} mode="raw" />
                </span>
              </span>
            </div>

            {/* transcript: min(840px, 100%) centred, 16px row gutter, 14px turn gap */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
                flex: 1,
                minHeight: 0,
                overflow: "hidden",
              }}
            >
              <div style={{ width: "min(840px, 100%)", marginInline: "auto", flexShrink: 0 }}>
                <UserTurn text="What landed since 0.4.2?" first />
                <div style={{ paddingInline: 16, paddingTop: 14 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <ToolLine verb="Ran" detail="git log --oneline v0.4.2..HEAD" />
                    <Prose>Fifteen commits across core, desktop and tui.</Prose>
                  </div>
                </div>
                <UserTurn text="Draft the release notes for 0.5.0 from CHANGELOG.md, then tighten the wording." />

                <div style={{ paddingInline: 16, paddingTop: 14 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <ToolLine verb="Read" detail="CHANGELOG.md" />

                    <div>
                      <ToolLine verb="Edited" detail="CHANGELOG.md" added={12} removed={3} />
                      <div
                        style={{
                          marginTop: 4,
                          marginBottom: 2,
                          overflow: "hidden",
                          border: `1px solid ${desktop.strokeSecondary}`,
                          borderRadius: 6,
                          background: desktop.technicalBg,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            minHeight: 30,
                            paddingInline: 12,
                            borderBottom: `1px solid ${desktop.technicalRing}`,
                          }}
                        >
                          <span
                            style={{
                              flex: 1,
                              minWidth: 0,
                              color: desktop.textSecondary,
                              fontFamily: desktop.mono,
                              fontSize: 12,
                            }}
                          >
                            CHANGELOG.md
                          </span>
                          <span style={{ display: "inline-flex", gap: 6, fontSize: 12 }}>
                            <span style={{ color: desktop.textSuccess }}>+12</span>
                            <span style={{ color: desktop.textDanger }}>-3</span>
                          </span>
                        </div>
                        <div
                          style={{
                            fontFamily: desktop.mono,
                            fontSize: 12,
                            lineHeight: "20px",
                            background: desktop.editor,
                          }}
                        >
                          <DiffRow sign=" " number="12" code="## 0.5.0" />
                          <DiffRow sign="-" number="13" code="- misc fixes" />
                          <DiffRow sign="+" number="13" code="- Sessions survive a snapshot" />
                          <DiffRow sign="+" number="14" code="- Composer keeps its draft" />
                          <DiffRow sign=" " number="15" code="" />
                        </div>
                      </div>
                    </div>

                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        minHeight: 22,
                        color: desktop.textTertiary,
                        fontSize: 15,
                        lineHeight: "24px",
                      }}
                    >
                      <IconChevronRightMedium size={11} color={desktop.iconTertiary} mode="raw" />
                      <span>Thought for 6s</span>
                    </div>

                    <Prose>
                      Grouped by package, one line each, with the two behaviour changes lifted to
                      the top of the file.
                    </Prose>

                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        paddingInlineStart: "2em",
                        fontSize: 15,
                        lineHeight: "24px",
                        letterSpacing: "-0.24px",
                      }}
                    >
                      <div style={{ position: "relative" }}>
                        <span
                          style={{
                            position: "absolute",
                            insetInlineStart: -18,
                            color: desktop.textQuaternary,
                          }}
                        >
                          •
                        </span>
                        A client past the event floor takes a snapshot and carries on.
                      </div>
                      <div style={{ position: "relative" }}>
                        <span
                          style={{
                            position: "absolute",
                            insetInlineStart: -18,
                            color: desktop.textQuaternary,
                          }}
                        >
                          •
                        </span>
                        Refs move by compare-and-swap, so a late write loses cleanly.
                      </div>
                    </div>

                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        minHeight: 22,
                        color: desktop.textSecondary,
                        fontSize: 15,
                        lineHeight: "24px",
                      }}
                    >
                      <span>Worked</span>
                      <span style={{ color: desktop.textTertiary }}>2 tools · 12.4s</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* composer dock: 12px lead-in, 840 measure, 14px inset, compact pill */}
            <div style={{ paddingTop: 12, background: desktop.chrome, flexShrink: 0 }}>
              <div
                style={{
                  width: "min(840px, 100%)",
                  marginInline: "auto",
                  paddingInline: 16,
                  paddingTop: 8,
                  paddingBottom: 14,
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "28px minmax(64px, 1fr) minmax(0, auto) 28px",
                    alignItems: "center",
                    gap: 8,
                    minHeight: 40,
                    padding: "4px 8px 4px 10px",
                    border: `1px solid ${desktop.strokeTertiary}`,
                    borderRadius: 9999,
                    background: desktop.composerBg,
                  }}
                >
                  <span
                    style={{
                      display: "grid",
                      placeItems: "center",
                      width: 28,
                      height: 28,
                      borderRadius: 9999,
                      background: desktop.fillSecondary,
                    }}
                  >
                    <IconPlusSmall size={16} color={desktop.iconSecondary} mode="raw" />
                  </span>
                  <span
                    style={{
                      minWidth: 0,
                      color: desktop.textTertiary,
                      fontSize: 15,
                      lineHeight: "24px",
                      letterSpacing: "-0.24px",
                    }}
                  >
                    Add a follow-up
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <span style={{ color: desktop.textSecondary, fontSize: 13 }}>
                      Claude Sonnet 4.5
                    </span>
                    <IconChevronDownMedium size={10} color={desktop.iconTertiary} mode="raw" />
                    <span
                      style={{
                        marginInlineStart: 4,
                        color: desktop.textTertiary,
                        fontSize: 11,
                        lineHeight: "22px",
                      }}
                    >
                      18%
                    </span>
                  </span>
                  <span
                    style={{
                      display: "grid",
                      placeItems: "center",
                      width: 28,
                      height: 28,
                      borderRadius: 9999,
                      background: desktop.fillPrimary,
                    }}
                  >
                    <IconArrowUp size={16} color={desktop.textInvert} mode="raw" />
                  </span>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </Frame>
  );
}

/* ── mobile ──────────────────────────────────────────────────────────────── */

function Chip({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 36,
        paddingInline: 14,
        borderRadius: 999,
        border: `1px solid ${mobile.border}`,
        background: mobile.surface,
        color: mobile.foreground,
        fontSize: 13,
        lineHeight: "18px",
        fontWeight: 500,
      }}
    >
      <span>{children}</span>
    </span>
  );
}

/** messages.tsx `userRow` + `userBubble`: raised fill, 20pt radius, 80% column. */
function UserBubble({ text }: { text: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 4,
        marginTop: 16,
        paddingBlock: 4,
      }}
    >
      <div
        style={{
          maxWidth: 280,
          paddingInline: 14,
          paddingBlock: 10,
          borderRadius: 20,
          background: mobile.raised,
        }}
      >
        <p style={{ margin: 0, fontSize: 16, lineHeight: "22px" }}>{text}</p>
      </div>
    </div>
  );
}

/** The agent reply is bare markdown on the canvas, inset by `conversation.textInset`. */
function AgentText({ children }: { children: ReactNode }) {
  return (
    <div style={{ paddingInline: 8, paddingBlock: 6 }}>
      <p style={{ margin: 0, fontSize: 16, lineHeight: "22px" }}>{children}</p>
    </div>
  );
}

/** A `work` row: the outcome label, its duration, and the disclosure chevron. */
function WorkRow({
  duration,
  expanded = false,
  children,
}: {
  duration: string;
  expanded?: boolean;
  children?: ReactNode;
}) {
  return (
    <div style={{ paddingInline: 8, paddingBlock: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, minHeight: 44 }}>
        <span style={{ color: mobile.muted, fontSize: 15, lineHeight: "20px" }}>Finished</span>
        <span
          style={{
            color: mobile.muted,
            fontSize: 15,
            lineHeight: "20px",
            opacity: 0.7,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {duration}
        </span>
        <span
          style={{
            display: "inline-flex",
            transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
          }}
        >
          <IconChevronRightMedium size={13} color={mobile.tertiary} mode="raw" />
        </span>
      </div>
      {children}
    </div>
  );
}

/** `checkpoint` renders as a plain secondary line. */
function Notice({ text }: { text: string }) {
  return (
    <div style={{ paddingInline: 8, paddingBlock: 6 }}>
      <p style={{ margin: 0, color: mobile.muted, fontSize: 15, lineHeight: "20px" }}>{text}</p>
    </div>
  );
}

export function MobileMock({ scale = 0.44 }: { scale?: number }) {
  return (
    <Frame width={390} height={760} scale={scale} radius={44} background={mobile.canvas}>
      <style href="nyte-mock-icon-stroke" precedence="default">
        {ICON_STROKE_RULE}
      </style>
      <div
        data-nyte-icon=""
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          background: mobile.canvas,
          color: mobile.foreground,
          fontFamily: mobile.sans,
        }}
      >
        {/* status bar inside the 59pt top inset */}
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: 59,
            paddingInline: 28,
            paddingTop: 12,
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: 0.1 }}>9:41</span>
          <span
            style={{
              position: "absolute",
              insetInlineStart: "50%",
              top: 11,
              width: 125,
              height: 37,
              marginInlineStart: -62,
              borderRadius: 19,
              background: "#000",
            }}
          />
          <span style={{ display: "inline-flex", alignItems: "flex-end", gap: 5 }}>
            <span style={{ display: "inline-flex", alignItems: "flex-end", gap: 2 }}>
              {[4, 6, 8, 10].map((height) => (
                <span
                  key={height}
                  style={{
                    width: 3,
                    height,
                    borderRadius: 1,
                    background: mobile.foreground,
                  }}
                />
              ))}
            </span>
            <svg
              viewBox="0 0 16 12"
              width={16}
              height={12}
              fill="none"
              style={{ display: "block" }}
            >
              <path
                d="M1 4.4a10 10 0 0 1 14 0M3.6 7a6.4 6.4 0 0 1 8.8 0"
                stroke={mobile.foreground}
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <circle cx="8" cy="9.8" r="1.3" fill={mobile.foreground} />
            </svg>
            <span
              style={{
                position: "relative",
                display: "inline-flex",
                alignItems: "center",
                width: 25,
                height: 12,
                borderRadius: 4,
                border: `1px solid ${mobile.tertiary}`,
                padding: 2,
              }}
            >
              <span
                style={{
                  width: "72%",
                  height: "100%",
                  borderRadius: 2,
                  background: mobile.foreground,
                }}
              />
              <span
                style={{
                  position: "absolute",
                  insetInlineEnd: -3,
                  width: 2,
                  height: 4,
                  borderRadius: 1,
                  background: mobile.tertiary,
                }}
              />
            </span>
          </span>
        </div>

        {/* glass nav bar: back chevron, session title, conversation menu */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            height: 44,
            paddingInline: 12,
            flexShrink: 0,
          }}
        >
          <span style={{ display: "grid", placeItems: "center", width: 44, height: 44 }}>
            <IconChevronLeftMedium size={20} color={mobile.foreground} mode="raw" />
          </span>
          <span
            style={{
              flex: 1,
              textAlign: "center",
              fontSize: 17,
              lineHeight: "22px",
              fontWeight: 600,
            }}
          >
            Release notes
          </span>
          <span style={{ display: "grid", placeItems: "center", width: 44, height: 44 }}>
            <IconDotGrid1x3HorizontalTight size={20} color={mobile.foreground} mode="raw" />
          </span>
        </div>

        {/* thread: 20pt gutters, 350pt content column */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            flex: 1,
            minHeight: 0,
            paddingInline: 20,
            overflow: "hidden",
          }}
        >
          <div style={{ flexShrink: 0 }}>
            <UserBubble text="Is the docs site in this release?" />
            <WorkRow duration="1.2s" />
            <AgentText>Yes, it ships from the same tag.</AgentText>
            <Notice text="Earlier context summarized" />
            <UserBubble text="What landed since 0.4.2?" />
            <WorkRow duration="3.1s" />
            <AgentText>Fifteen commits across core, desktop and tui.</AgentText>
            <UserBubble text="Tighten the wording and ship it." />

            <WorkRow duration="12.4s" expanded>
              <div style={{ display: "flex", flexDirection: "column", paddingInlineStart: 22 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44 }}>
                  <span
                    style={{
                      display: "grid",
                      placeItems: "center",
                      width: 20,
                      height: 20,
                      borderRadius: 6,
                      background: mobile.fill,
                      color: mobile.muted,
                      fontSize: 11,
                      lineHeight: "14px",
                      fontWeight: 600,
                    }}
                  >
                    M
                  </span>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 15,
                      lineHeight: "20px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    CHANGELOG.md
                  </span>
                  <span
                    style={{
                      color: mobile.muted,
                      fontSize: 13,
                      lineHeight: "18px",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    +12 −3
                  </span>
                  <IconChevronRightMedium size={13} color={mobile.tertiary} mode="raw" />
                </div>
              </div>
            </WorkRow>

            <AgentText>
              Two entries changed behaviour, so they lead. The rest are one line each, in package
              order.
            </AgentText>
          </div>
        </div>

        {/* review strip and the morphing composer pill */}
        <div style={{ paddingInline: 20, flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 8, paddingBottom: 8 }}>
            <Chip>
              <span>{"Review "}</span>
              <span style={{ color: mobile.success }}>{"+12 "}</span>
              <span style={{ color: mobile.danger }}>−3</span>
            </Chip>
            <Chip>Ask to merge</Chip>
          </div>
        </div>
        <div style={{ paddingInline: 20, paddingTop: 4, flexShrink: 0 }}>
          <div
            style={{
              position: "relative",
              height: 48,
              marginInline: 16,
              borderRadius: 24,
              border: `1px solid ${mobile.border}`,
              background: mobile.surface,
            }}
          >
            <span
              style={{
                position: "absolute",
                insetInlineStart: 7,
                bottom: 7,
                display: "grid",
                placeItems: "center",
                width: 34,
                height: 34,
              }}
            >
              <IconPlusMedium size={20} color={mobile.foreground} mode="raw" />
            </span>
            <span
              style={{
                position: "absolute",
                insetInlineStart: 48,
                top: 13,
                height: 22,
                fontSize: 17,
                lineHeight: "22px",
              }}
            >
              Also bump the version
            </span>
            <span
              style={{
                position: "absolute",
                insetInlineEnd: 8,
                bottom: 8,
                display: "grid",
                placeItems: "center",
                width: 32,
                height: 32,
                borderRadius: 16,
                background: mobile.accent,
              }}
            >
              <IconArrowUp size={16} color={mobile.foreground} mode="raw" />
            </span>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            placeItems: "center",
            height: 34,
            flexShrink: 0,
          }}
        >
          <span style={{ width: 140, height: 5, borderRadius: 3, background: mobile.foreground }} />
        </div>
      </div>
    </Frame>
  );
}

/* ── tui ─────────────────────────────────────────────────────────────────── */

const RULE = "─".repeat(120);

function TuiRow({ children, indent = 2 }: { children: ReactNode; indent?: number }) {
  return (
    <div style={{ paddingInlineStart: `${indent}ch`, paddingInlineEnd: "1ch", whiteSpace: "pre" }}>
      {children}
    </div>
  );
}

/** appendUser: a one-cell margin, three cells of lead-in, a blank row either side. */
function TuiUserBlock({ text }: { text: string }) {
  return (
    <div
      style={{
        marginInline: "1ch",
        paddingInlineStart: "3ch",
        paddingInlineEnd: "1ch",
        paddingBlock: "19px",
        background: tui.userBackground,
        whiteSpace: "pre",
      }}
    >
      {text}
    </div>
  );
}

export function TuiMock({ scale = 0.52 }: { scale?: number }) {
  return (
    <Frame width={620} height={380} scale={scale} radius={10} background={tui.terminal}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          padding: 6,
          background: tui.terminal,
          color: tui.foreground,
          fontFamily: tui.mono,
          fontSize: 13,
          lineHeight: "19px",
          fontVariantLigatures: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: "100%",
            height: "100%",
            background: tui.background,
          }}
        >
          {/* transcript: 1ch scroll padding, its thumb against the right edge */}
          <div
            style={{
              display: "flex",
              flex: 1,
              minHeight: 0,
              paddingInline: "1ch",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
                flex: 1,
                minWidth: 0,
              }}
            >
              <div style={{ flexShrink: 0 }}>
                <TuiUserBlock text="What landed since 0.4.2?" />
                <div style={{ height: 19 }} />
                <TuiRow>
                  <span style={{ color: tui.ok }}>✓</span>
                  <span style={{ color: tui.foreground }}>
                    {" "}
                    bash git log --oneline v0.4.2..HEAD
                  </span>
                  <span style={{ color: tui.dim }}>{"  15 lines · 0.3s"}</span>
                </TuiRow>
                <div style={{ height: 19 }} />
                <TuiRow>
                  <span>Fifteen commits across core, desktop and tui.</span>
                </TuiRow>
                <div style={{ height: 19 }} />
                <TuiRow>
                  <span style={{ color: tui.dim }}>Worked for 3.1s</span>
                </TuiRow>
                <div style={{ height: 19 }} />
                <TuiUserBlock text="Draft the release notes for 0.5.0" />
                <div style={{ height: 19 }} />
                <TuiRow>
                  <span style={{ color: tui.ok }}>✓</span>
                  <span style={{ color: tui.foreground }}> read CHANGELOG.md</span>
                  <span style={{ color: tui.dim }}>{"  214 lines · 1.2s"}</span>
                </TuiRow>
                <TuiRow>
                  <span style={{ color: tui.ok }}>✓</span>
                  <span style={{ color: tui.foreground }}> edit CHANGELOG.md</span>
                  <span style={{ color: tui.dim }}>{"  +12 -3 · 0.4s"}</span>
                </TuiRow>
                <TuiRow>
                  <span style={{ color: tui.thinking }}>◆ Thought</span>
                  <span style={{ color: tui.dim }}> 6.2s</span>
                </TuiRow>
                <div style={{ height: 19 }} />
                <TuiRow>
                  <span>Fifteen commits since v0.4.2, grouped by package and cut</span>
                </TuiRow>
                <TuiRow>
                  <span>to one line each. The two behaviour changes lead.</span>
                </TuiRow>
                <div style={{ height: 19 }} />
                <TuiRow>
                  <span style={{ color: tui.dim }}>Worked for 12.4s</span>
                </TuiRow>
                <div style={{ height: 19 }} />
              </div>
            </div>
            <div style={{ width: "1ch", background: tui.scrollbarTrack, position: "relative" }}>
              <span
                style={{
                  position: "absolute",
                  insetInline: 0,
                  top: "46%",
                  height: "54%",
                  background: tui.scrollbarThumb,
                }}
              />
            </div>
          </div>

          {/* composer: rounded top/side border, ❯ prompt, powerline rule, hints */}
          <div style={{ flexShrink: 0, marginInline: "1ch" }}>
            <div style={{ display: "flex", color: tui.promptBorderFocused, whiteSpace: "pre" }}>
              <span>╭</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>{RULE}</span>
              <span>╮</span>
            </div>
            <div style={{ display: "flex", whiteSpace: "pre" }}>
              <span style={{ color: tui.promptBorderFocused }}>│</span>
              <span style={{ paddingInline: "1ch", display: "flex", flex: 1, minWidth: 0 }}>
                <span style={{ color: tui.user }}>❯ </span>
                <span style={{ color: tui.dim }}>Plan, search, build anything</span>
              </span>
              <span style={{ color: tui.promptBorderFocused }}>│</span>
            </div>
            <div style={{ display: "flex", whiteSpace: "pre" }}>
              <span style={{ color: tui.promptBorderFocused }}>╰─ </span>
              <span style={{ color: tui.path }}>nyte main*</span>
              <span style={{ color: tui.promptBorderFocused }}> │ </span>
              <span style={{ color: tui.accent }}>claude-sonnet-4-5</span>
              <span style={{ color: tui.promptBorderFocused }}> │ </span>
              <span style={{ color: tui.thinking }}>high</span>
              <span style={{ color: tui.promptBorderFocused }}> │ </span>
              <span style={{ color: tui.dim }}>24.1k/200k · 18% context</span>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  color: tui.promptBorderFocused,
                }}
              >
                {` ${RULE}`}
              </span>
              <span style={{ color: tui.promptBorderFocused }}>╯</span>
            </div>
          </div>
          <div
            style={{
              flexShrink: 0,
              marginInline: "1ch",
              overflow: "hidden",
              whiteSpace: "pre",
            }}
          >
            <span style={{ color: tui.dim }}>{"  "}</span>
            <span style={{ color: tui.user }}>enter</span>
            <span style={{ color: tui.dim }}> send</span>
            <span style={{ color: tui.muted }}> · </span>
            <span style={{ color: tui.user }}>esc</span>
            <span style={{ color: tui.dim }}> tree (twice)</span>
            <span style={{ color: tui.muted }}> · </span>
            <span style={{ color: tui.user }}>ctrl+k</span>
            <span style={{ color: tui.dim }}> help</span>
            <span style={{ color: tui.muted }}> · </span>
            <span style={{ color: tui.user }}>shift+tab</span>
            <span style={{ color: tui.dim }}> thinking</span>
          </div>
        </div>
      </div>
    </Frame>
  );
}
