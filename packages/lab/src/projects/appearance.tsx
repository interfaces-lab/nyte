/** A project's face: its glyph in its hue, with the coordinator's status pinned to a corner. */
import { create, keyframes, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import type { SessionMark } from "@nyte-ai/plugin/client/presentation";
import { Icon } from "@nyte-ai/ui/icon";
import { glyph, radius } from "@nyte-ai/ui/styles/schema.stylex";
import { intent, surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import type { Appearance, ProjectListing } from "./timeline";

/** The surface the glyph sits on, so the badge's ring cuts it cleanly. */
type GlyphSurface = "sidebar" | "popup" | "card";

export function projectMark(project: Pick<ProjectListing, "ask" | "working">): SessionMark {
  if (project.ask !== undefined) return "waiting";

  return project.working > 0 ? "working" : "idle";
}

function badgeTone(mark: SessionMark) {
  switch (mark) {
    case "working":
      return intent.primary;
    case "waiting":
    case "retry":
      return intent.warning;
    case "failed":
      return intent.danger;
    case "idle":
      return undefined;
    default: {
      const _exhaustive: never = mark;

      return _exhaustive;
    }
  }
}

export function ProjectGlyph({
  appearance,
  mark,
  surface,
}: {
  readonly appearance: Appearance;
  readonly mark: SessionMark;
  readonly surface: GlyphSurface;
}): ReactElement {
  const tone = badgeTone(mark);

  return (
    <span {...props(surfaceTheme[appearance.tint], styles.tile)}>
      <Icon name={appearance.icon} size={12} />
      {tone !== undefined && (
        <span
          {...props(
            tone,
            styles.badge,
            surface === "sidebar" && styles.ringSidebar,
            surface === "popup" && styles.ringPopup,
            surface === "card" && styles.ringCard,
            mark === "working" && styles.pulse,
          )}
        />
      )}
    </span>
  );
}

const pulse = keyframes({
  "0%": { opacity: 1 },
  "50%": { opacity: 0.35 },
  "100%": { opacity: 1 },
});

const styles = create({
  tile: {
    position: "relative",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    width: glyph.md,
    height: glyph.md,
    borderRadius: radius.indicator,
    backgroundColor: role.bgInteractivePrimaryTranslucent,
    color: role.contentInteractivePrimary,
  },
  badge: {
    position: "absolute",
    insetInlineEnd: -3,
    insetBlockEnd: -3,
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: role.bgInteractivePrimary,
  },
  ringSidebar: { boxShadow: `0 0 0 2px ${role.sidebarMaterial}` },
  ringPopup: { boxShadow: `0 0 0 2px ${role.popupMaterial}` },
  ringCard: { boxShadow: `0 0 0 2px ${role.bgBase}` },
  pulse: {
    animationName: { default: pulse, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: "1.6s",
    animationIterationCount: "infinite",
  },
});
