import { create, props } from "@stylexjs/stylex";
import { createContext, use, useState } from "react";
import type { ReactElement } from "react";
import { Icon } from "@nyte-ai/ui/icon";
import { button, glyph, radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { intent } from "@nyte-ai/ui/surface-theme";
import type { ShotId } from "./model.ts";
import { styles as parts } from "./parts.tsx";

const SHOT_NARROW = "@container shot (max-width: 520px)";

const SHOT_TINY = "@container shot (max-width: 360px)";

type Scheme = "light" | "dark";

/** The page's scheme; a shot starts there and can flip on its own. */
export const PageScheme = createContext<Scheme>("light");

const styles = create({
  shot: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    containerType: "inline-size",
    containerName: "shot",
  },
  bar: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s3,
  },
  pair: {
    display: "grid",
    gridTemplateColumns: {
      default: "repeat(2, minmax(0, 1fr))",
      [SHOT_NARROW]: "minmax(0, 1fr)",
    },
    gap: space.s3,
  },
  frame: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0, margin: 0 },
  stage: {
    display: "grid",
    placeItems: "center",
    minHeight: 152,
    padding: space.s3,
    borderRadius: radius.card,
    backgroundColor: role.bgMuted,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
    color: role.contentPrimary,
    overflow: "hidden",
  },
  dark: { colorScheme: "dark" },
  light: { colorScheme: "light" },
  caption: { display: "flex", alignItems: "center", gap: space.s1_5, color: role.contentSecondary },
  verdict: { color: role.contentInteractivePrimary },
  zoom: { zoom: { default: 2, [SHOT_TINY]: 1.5 } },
  zoomSoft: { zoom: { default: 1.5, [SHOT_TINY]: 1.25 } },
  panel: {
    display: "flex",
    flexDirection: "column",
    width: 180,
    height: 112,
    borderRadius: 8,
    backgroundColor: role.bgBase,
    boxShadow: `0 0 0 1px ${role.borderSecondaryTranslucent}`,
    fontFamily: type.fontSans,
    overflow: "hidden",
  },
  panelHead: {
    paddingInline: 8,
    paddingBlock: 5,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: role.borderSecondaryTranslucent,
    color: role.contentSecondary,
    fontSize: 10,
    lineHeight: "14px",
  },
  panelBody: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    flex: 1,
  },
  panelIcon: {
    display: "inline-flex",
    marginBlockEnd: 2,
    color: role.contentDisabled,
    transform: "translateY(-2px)",
  },
  panelText: { color: role.contentTertiary, fontSize: 13, lineHeight: "16px" },
  panelSmall: { color: role.contentTertiary, fontSize: 11, lineHeight: "14px" },
  app: {
    display: "flex",
    width: 200,
    height: 104,
    borderRadius: 8,
    backgroundColor: role.bgBase,
    boxShadow: `0 0 0 1px ${role.borderSecondaryTranslucent}`,
    overflow: "hidden",
  },
  appSide: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    width: 52,
    padding: 8,
    backgroundColor: role.bgMuted,
  },
  appMain: { display: "flex", flexDirection: "column", gap: 8, flex: 1, padding: 10 },
  line: {
    display: "block",
    height: 6,
    borderRadius: 3,
    backgroundColor: role.borderSecondaryTranslucent,
    flex: 1,
  },
  lineShort: { flex: "none", width: "55%" },
  focusRow: {
    display: "flex",
    alignItems: "center",
    height: glyph.lg,
    marginInline: -6,
    paddingInlineEnd: 8,
    borderRadius: 5,
    boxShadow: `0 0 0 1px ${role.contentInteractivePrimary}`,
  },
  dotGlyph: {
    width: 8,
    height: 8,
    flexShrink: 0,
    borderRadius: 2,
    backgroundColor: role.contentInteractivePrimary,
  },
  rowScene: { position: "relative", display: "flex", alignItems: "flex-start", gap: 6 },
  window: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    paddingInline: 8,
    borderRadius: 6,
    backgroundColor: role.bgBase,
    boxShadow: `0 0 0 1px ${role.borderSecondaryTranslucent}`,
    fontFamily: type.fontSans,
    fontSize: 11,
    lineHeight: "14px",
    whiteSpace: "nowrap",
  },
  sidebarRow: {
    position: "relative",
    width: 92,
    backgroundColor: role.bgHover,
    boxShadow: "none",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  overshoot: {
    position: "absolute",
    insetInline: 0,
    bottom: 0,
    backgroundColor: `color-mix(in oklab, ${role.contentInteractivePrimary} 45%, transparent)`,
  },
  rowLabel: { overflow: "hidden", textOverflow: "ellipsis" },
  guide: {
    position: "absolute",
    insetInline: -10,
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "dashed",
    borderBlockStartColor: role.contentInteractivePrimary,
    pointerEvents: "none",
  },
  composer: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    width: "max-content",
    padding: 4,
    borderRadius: 9,
    backgroundColor: role.bgBase,
    boxShadow: `0 0 0 1px ${role.borderSecondaryTranslucent}`,
    fontFamily: type.fontSans,
    fontSize: 10,
    lineHeight: "14px",
  },
  composerSpacer: { width: 12 },
  composerGlyph: { display: "inline-flex", color: role.contentTertiary, padding: 2 },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    height: button.height2xs,
    paddingInline: 5,
    borderRadius: 5,
    backgroundColor: role.bgMuted,
    color: role.contentSecondary,
    whiteSpace: "nowrap",
    minWidth: 0,
  },
  chipClipped: { maxWidth: 64 },
  chipText: { overflow: "hidden", textOverflow: "ellipsis" },
  send: {
    display: "grid",
    placeItems: "center",
    width: glyph.lg,
    height: glyph.lg,
    borderRadius: 9,
    backgroundColor: role.contentPrimary,
    color: role.bgBase,
  },
});

const SHOTS: Readonly<
  Record<
    ShotId,
    {
      readonly label: string;
      readonly before: string;
      readonly after: string;
      readonly frames: readonly [string, string];
      readonly verdict: boolean;
      readonly scene: (stage: "before" | "after") => ReactElement;
    }
  >
> = {
  "row-height": {
    label: "Sidebar row against the tab strip, 2×",
    before: "Row 34px, tab 32px",
    after: "Row 32px, tab 32px",
    frames: ["Before", "After"],
    verdict: true,
    scene: (stage) => (
      <div {...props(styles.zoom)}>
        <div {...props(styles.rowScene)}>
          <span {...props(styles.window)} style={{ height: 32 }}>
            <Icon name="layers" size={12} />
            Polish
          </span>
          <span
            {...props(styles.window, styles.sidebarRow)}
            style={{ height: stage === "before" ? 34 : 32 }}
          >
            <span {...props(styles.rowLabel)}>Investigate swallowed</span>
            {stage === "before" && (
              <span
                aria-hidden="true"
                {...props(intent.danger, styles.overshoot)}
                style={{ height: 2 }}
              />
            )}
          </span>
          <span aria-hidden="true" {...props(intent.primary, styles.guide)} style={{ top: 32 }} />
        </div>
      </div>
    ),
  },
  "model-chip": {
    label: "Composer footer, 2×",
    before: "Chip clipped at 64px",
    after: "Chip fits the name",
    frames: ["Before", "After"],
    verdict: true,
    scene: (stage) => (
      <div {...props(styles.zoom)}>
        <div {...props(styles.composer)}>
          <span {...props(styles.composerGlyph)}>
            <Icon name="plus" size={10} />
          </span>
          <span {...props(styles.composerSpacer)} />
          <span {...props(styles.chip, stage === "before" && styles.chipClipped)}>
            <Icon name="model-anthropic" size={9} />
            <span {...props(styles.chipText)}>Claude Opus 5.5</span>
          </span>
          <span {...props(styles.send)}>
            <Icon name="arrow-up" size={10} />
          </span>
        </div>
      </div>
    ),
  },
  "empty-state": {
    label: "Changes panel with nothing changed, 1.5×",
    before: "Plain text, 13px",
    after: "Icon 2px high, message 11px",
    frames: ["main", "#489"],
    verdict: false,
    scene: (stage) => (
      <div {...props(styles.zoomSoft)}>
        <div {...props(styles.panel)}>
          <span {...props(styles.panelHead)}>Changes</span>
          <span {...props(styles.panelBody)}>
            {stage === "after" && (
              <span {...props(styles.panelIcon)}>
                <Icon name="diff" size={16} />
              </span>
            )}
            <span {...props(stage === "after" ? styles.panelSmall : styles.panelText)}>
              {stage === "after" ? "No changes yet" : "No changes"}
            </span>
          </span>
        </div>
      </div>
    ),
  },
  generic: {
    label: "Where the change shows, 1.5×",
    before: "Off the 4px scale",
    after: "On the scale",
    frames: ["Before", "After"],
    verdict: true,
    scene: (stage) => (
      <div {...props(styles.zoomSoft)}>
        <div {...props(styles.app)}>
          <span {...props(styles.appSide)}>
            <span {...props(styles.line)} />
            <span {...props(styles.line, styles.lineShort)} />
            <span {...props(styles.line)} />
          </span>
          <span {...props(styles.appMain)}>
            <span {...props(styles.line, styles.lineShort)} />
            <span
              {...props(stage === "before" ? intent.danger : intent.success, styles.focusRow)}
              style={{
                gap: stage === "before" ? 6 : 4,
                paddingInlineStart: stage === "before" ? 7 : 8,
              }}
            >
              <span {...props(styles.dotGlyph)} />
              <span {...props(styles.line)} />
            </span>
            <span {...props(styles.line)} />
            <span {...props(styles.line, styles.lineShort)} />
          </span>
        </div>
      </div>
    ),
  },
};

/** Before and after, side by side, in either scheme. */
export function Shot({ id }: { readonly id: ShotId }): ReactElement {
  const page = use(PageScheme);
  const [chosen, setChosen] = useState<Scheme | null>(null);
  const scheme = chosen ?? page;
  const shot = SHOTS[id];

  return (
    <div {...props(styles.shot)}>
      <div {...props(styles.bar)}>
        <span {...props(text.sm, styles.caption)}>{shot.label}</span>
        <ToggleGroup
          aria-label="Scheme"
          value={[scheme]}
          onValueChange={(values) => {
            const next = values.at(-1);

            if (next === "light" || next === "dark") setChosen(next);
          }}
        >
          <Toggle value="light" size="xs">
            Light
          </Toggle>
          <Toggle value="dark" size="xs">
            Dark
          </Toggle>
        </ToggleGroup>
      </div>
      <div {...props(styles.pair)}>
        {(["before", "after"] as const).map((stage) => (
          <figure key={stage} {...props(styles.frame)}>
            <span {...props(parts.group)}>{shot.frames[stage === "before" ? 0 : 1]}</span>
            <div {...props(styles.stage, scheme === "dark" ? styles.dark : styles.light)}>
              {shot.scene(stage)}
            </div>
            <figcaption
              {...props(
                text.sm,
                styles.caption,
                stage === "after" && shot.verdict && intent.success,
                stage === "after" && shot.verdict && styles.verdict,
              )}
            >
              {stage === "after" && shot.verdict && <Icon name="checkmark" size={12} />}
              {stage === "before" ? shot.before : shot.after}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
