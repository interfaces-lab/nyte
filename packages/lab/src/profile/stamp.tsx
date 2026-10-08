/**
 * A rubber stamp, drawn rather than bordered, then run through an ink filter:
 * the edge wanders with the paper fibre, pressure falls off across the face,
 * and the grain leaves pores where no ink took.
 */
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { srOnly } from "@nyte-ai/ui/a11y.stylex";
import { surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { role } from "@nyte-ai/ui/vars.stylex";
import { formatDate, type Stamp } from "./fixtures";

function InkFilter({ id, seed }: { readonly id: string; readonly seed: number }): ReactElement {
  return (
    <filter id={id} x="-4%" y="-4%" width="108%" height="108%">
      <feTurbulence
        type="fractalNoise"
        baseFrequency="0.6"
        numOctaves={2}
        seed={seed}
        result="fibre"
      />
      <feDisplacementMap
        in="SourceGraphic"
        in2="fibre"
        scale={1.4}
        xChannelSelector="R"
        yChannelSelector="G"
        result="edge"
      />
      <feTurbulence type="fractalNoise" baseFrequency="0.028" numOctaves={2} seed={seed + 11} />
      {/* DERIVED: fractal noise sits around 0.5, so most of the face takes full ink and the thinnest patch keeps about a third. */}
      <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.8 0 0 0 0.1" result="pressure" />
      <feComposite in="edge" in2="pressure" operator="in" result="pressed" />
      <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves={1} seed={seed + 23} />
      <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -10 0 0 0 7" result="pores" />
      <feComposite in="pressed" in2="pores" operator="in" />
    </filter>
  );
}

function Ring({ stamp, id }: { readonly stamp: Stamp; readonly id: string }): ReactElement {
  return (
    <svg aria-hidden="true" width={116} height={116} viewBox="0 0 116 116" {...props(styles.svg)}>
      <defs>
        <InkFilter id={`${id}-ink`} seed={Math.abs(stamp.tilt) * 7} />
        <path id={`${id}-top`} d="M15 58A43 43 0 0 1 101 58" />
        <path id={`${id}-bottom`} d="M8 58A50 50 0 0 0 108 58" />
      </defs>
      <g filter={`url(#${id}-ink)`}>
        <circle cx={58} cy={58} r={54} fill="none" stroke="currentColor" strokeWidth={2.4} />
        <circle cx={58} cy={58} r={39} fill="none" stroke="currentColor" strokeWidth={1} />
        <circle cx={11.5} cy={58} r={1.5} />
        <circle cx={104.5} cy={58} r={1.5} />
        <text {...props(styles.arc)}>
          <textPath href={`#${id}-top`} startOffset="50%" textAnchor="middle">
            {stamp.caption}
          </textPath>
        </text>
        <text {...props(styles.arc)}>
          <textPath href={`#${id}-bottom`} startOffset="50%" textAnchor="middle">
            {formatDate(stamp.date)}
          </textPath>
        </text>
        <text x={58} y={64} textAnchor="middle" {...props(styles.title, styles.titleRing)}>
          {stamp.title}
        </text>
      </g>
    </svg>
  );
}

function Plate({ stamp, id }: { readonly stamp: Stamp; readonly id: string }): ReactElement {
  return (
    <svg aria-hidden="true" width={140} height={80} viewBox="0 0 140 80" {...props(styles.svg)}>
      <defs>
        <InkFilter id={`${id}-ink`} seed={Math.abs(stamp.tilt) * 7} />
      </defs>
      <g filter={`url(#${id}-ink)`}>
        <rect
          x={2}
          y={2}
          width={136}
          height={76}
          rx={6}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.4}
        />
        <rect
          x={7}
          y={7}
          width={126}
          height={66}
          rx={2.5}
          fill="none"
          stroke="currentColor"
          strokeWidth={0.9}
        />
        <text x={70} y={32} textAnchor="middle" {...props(styles.title)}>
          {stamp.title}
        </text>
        <path d="M36 40.5H104" stroke="currentColor" strokeWidth={0.9} />
        <text x={70} y={53} textAnchor="middle" {...props(styles.caption)}>
          {stamp.caption}
        </text>
        <text x={70} y={64} textAnchor="middle" {...props(styles.date)}>
          {formatDate(stamp.date)}
        </text>
      </g>
    </svg>
  );
}

function Oval({ stamp, id }: { readonly stamp: Stamp; readonly id: string }): ReactElement {
  return (
    <svg aria-hidden="true" width={158} height={94} viewBox="0 0 158 94" {...props(styles.svg)}>
      <defs>
        <InkFilter id={`${id}-ink`} seed={Math.abs(stamp.tilt) * 7} />
      </defs>
      <g filter={`url(#${id}-ink)`}>
        <ellipse
          cx={79}
          cy={47}
          rx={75}
          ry={43}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.4}
        />
        <ellipse
          cx={79}
          cy={47}
          rx={69}
          ry={37}
          fill="none"
          stroke="currentColor"
          strokeWidth={0.9}
        />
        <text x={79} y={30} textAnchor="middle" {...props(styles.date)}>
          {formatDate(stamp.date)}
        </text>
        <text x={79} y={52} textAnchor="middle" {...props(styles.title)}>
          {stamp.title}
        </text>
        <text x={79} y={66} textAnchor="middle" {...props(styles.caption)}>
          {stamp.caption}
        </text>
      </g>
    </svg>
  );
}

const FRAMES = { ring: Ring, plate: Plate, oval: Oval } as const;

export function StampMark({
  stamp,
  id,
}: {
  readonly stamp: Stamp;
  readonly id: string;
}): ReactElement {
  const Frame = FRAMES[stamp.frame];

  return (
    <li {...props(styles.cell)}>
      <span
        {...props(
          surfaceTheme[stamp.tint],
          styles.stamp,
          styles.place(
            `${String(stamp.tilt)}deg`,
            `${String(stamp.offset[0])}px`,
            `${String(stamp.offset[1])}px`,
          ),
        )}
      >
        <Frame stamp={stamp} id={id} />
      </span>
      <span {...props(srOnly)}>
        {stamp.title}, {stamp.caption}, <time dateTime={stamp.date}>{formatDate(stamp.date)}</time>
      </span>
    </li>
  );
}

const styles = create({
  cell: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minBlockSize: 112,
  },
  stamp: {
    display: "flex",
    /* DERIVED: on paper, ink a shade deeper than the accent so it reads as pigment rather than a link; on a dark page, sunk toward the page so it doesn't glow. */
    color: `light-dark(color-mix(in oklab, ${role.contentInteractivePrimary} 84%, #000), color-mix(in oklab, ${role.contentInteractivePrimary} 72%, ${role.bgElevated}))`,
    opacity: 0.9,
  },
  place: (angle: string, x: string, y: string) => ({
    transform: `translate(${x}, ${y}) rotate(${angle})`,
  }),
  svg: {
    display: "block",
    overflow: "visible",
    fontVariantNumeric: "tabular-nums",
  },
  title: {
    fill: "currentColor",
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: "-0.01em",
  },
  titleRing: {
    fontSize: 17,
  },
  caption: {
    fill: "currentColor",
    fontSize: 9.5,
    fontWeight: 600,
    letterSpacing: "0.01em",
  },
  date: {
    fill: "currentColor",
    fontSize: 9,
    fontWeight: 600,
    letterSpacing: "0.04em",
  },
  arc: {
    fill: "currentColor",
    fontSize: 9,
    fontWeight: 600,
    letterSpacing: "0.08em",
  },
});
