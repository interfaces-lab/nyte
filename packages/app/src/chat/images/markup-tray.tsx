import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { Toggle } from "@nyte-ai/ui/toggle";
import { platformRamps } from "@nyte-ai/ui/platform-ramps";
import { control, space } from "@nyte-ai/ui/styles/schema.stylex";
import { motion, role } from "@nyte-ai/ui/styles/vars.stylex";
import { highlighterColor, inkColor, poolColor } from "./markup.ts";
import type { Ink, Marker, Tool } from "./markup.ts";

export const PENS = [
  { tool: "pen", label: "Pen", key: "P" },
  { tool: "highlight", label: "Highlighter", key: "H" },
  { tool: "eraser", label: "Eraser", key: "E" },
] as const;

type Pen = (typeof PENS)[number]["tool"];

const RUBBER = platformRamps.pink.opaque["40"];

const styles = create({
  tray: {
    display: "flex",
    alignItems: "flex-end",
    alignSelf: "stretch",
    gap: space.s1,
    marginBlockEnd: `calc(0px - ${space.s1})`,
    overflow: "clip",
  },
  slot: { width: control.heightXl },
  art: {
    position: "absolute",
    insetBlockStart: `calc(0px - ${space.s2})`,
    left: "50%",
    translate: "-50% 0",
    width: control.heightXl,
    aspectRatio: "34 / 84",
    overflow: "visible",
    pointerEvents: "none",
    transform: `translateY(${space.s3})`,
    transitionProperty: "transform",
    transitionDuration: {
      default: motion.durationNormal,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOutQuint,
  },
  raised: { transform: "none" },
  barrel: { fill: role.bgElevated, stroke: role.strokeSecondary, strokeWidth: 1 },
  grip: { fill: role.fillSecondary },
});

export function Tray(input: {
  readonly tool: Tool;
  readonly inks: Readonly<Record<Marker, Ink>>;
  readonly onTool: (tool: Pen) => void;
}): ReactElement {
  return (
    <div role="group" aria-label="Instruments" {...props(styles.tray)}>
      {PENS.map((pen) => (
        <Toggle
          key={pen.tool}
          size="lg"
          iconOnly
          indicator="glyph"
          aria-label={pen.label}
          title={`${pen.label} (${pen.key})`}
          aria-keyshortcuts={pen.key}
          pressed={input.tool === pen.tool}
          onPressedChange={() => input.onTool(pen.tool)}
          xstyle={styles.slot}
        >
          <svg
            viewBox="0 0 34 84"
            aria-hidden="true"
            {...props(styles.art, input.tool === pen.tool && styles.raised)}
          >
            <Instrument
              tool={pen.tool}
              ink={pen.tool === "eraser" ? undefined : input.inks[pen.tool]}
            />
          </svg>
        </Toggle>
      ))}
    </div>
  );
}

function Instrument(input: { readonly tool: Pen; readonly ink: Ink | undefined }): ReactElement {
  if (input.tool === "eraser" || input.ink === undefined)
    return (
      <g>
        <rect x={8} y={12} width={18} height={30} rx={5} fill={RUBBER} />
        <rect x={7} y={36} width={20} height={58} rx={3} {...props(styles.barrel)} />
        <rect x={7.5} y={46} width={19} height={3} {...props(styles.grip)} />
      </g>
    );

  if (input.tool === "highlight")
    return (
      <g>
        <path
          d="M11 22 L12 11 L24 4 L24 22 Z"
          fill={highlighterColor(input.ink)}
          stroke={poolColor(input.ink)}
          strokeWidth={0.75}
          strokeLinejoin="round"
        />
        <path d="M7 34 L11 22 L24 22 L28 34 Z" {...props(styles.barrel)} />
        <rect x={5} y={34} width={25} height={60} rx={6} {...props(styles.barrel)} />
        <rect x={5.5} y={34.5} width={24} height={9} fill={poolColor(input.ink)} />
        <rect x={14.5} y={50} width={6} height={30} rx={3} fill={highlighterColor(input.ink)} />
      </g>
    );

  return (
    <g>
      <path d="M9 34 L14.5 12 L19.5 12 L25 34 Z" {...props(styles.barrel)} />
      <path d="M14.5 12 L17 3 L19.5 12 Z" fill={inkColor(input.ink)} />
      <rect x={9} y={34} width={16} height={60} rx={3} {...props(styles.barrel)} />
      <rect x={9.5} y={34.5} width={15} height={12} {...props(styles.grip)} />
      <rect x={9.5} y={54} width={15} height={4} fill={inkColor(input.ink)} />
    </g>
  );
}
