import { useId, type ReactNode } from "react";
import {
  apart,
  cell,
  contrast,
  contrastOver,
  corner,
  crescentPath,
  light,
  moon,
  night,
  rampStops,
  shadow,
  shadowRing,
  tile,
  tileCorner,
  units,
} from "./geometry";

const deepBlue = night.ramp[0];

const nyteBlue = night.ramp[night.ramp.length - 1];

const lines = Array.from({ length: 7 }, (_, index) => (index + 1) * cell);

const ticks = Array.from({ length: 9 }, (_, index) => index);

interface Fact {
  label: string;
  value: string;
}

function Plate(props: {
  title: string;
  description: string;
  viewBox: string;
  facts: readonly Fact[];
  children: ReactNode;
}) {
  const id = useId();

  return (
    <figure className="design-trip-plate">
      <svg
        viewBox={props.viewBox}
        role="img"
        aria-labelledby={`${id}-title ${id}-description`}
        className="design-trip-drawing"
      >
        <title id={`${id}-title`}>{props.title}</title>
        <desc id={`${id}-description`}>{props.description}</desc>
        {props.children}
      </svg>
      <figcaption className="design-trip-facts-caption">
        <span className="design-trip-plate-title">{props.title}</span>
        <dl className="design-trip-facts">
          {props.facts.map((fact) => (
            <div key={fact.label} className="design-trip-fact">
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      </figcaption>
    </figure>
  );
}

function Grid() {
  return (
    <g aria-hidden="true">
      <rect width={tile} height={tile} className="design-trip-tile" />
      <path
        className="design-trip-gridline"
        d={lines.map((at) => `M ${at} 0 V ${tile} M 0 ${at} H ${tile}`).join(" ")}
      />
      {ticks.map((at) => (
        <g key={at} className="design-trip-axis">
          <text x={at * cell} y={-4} textAnchor="middle">
            {at}
          </text>
          <text x={-4} y={at * cell + 1.4} textAnchor="end">
            {at}
          </text>
        </g>
      ))}
    </g>
  );
}

function Circles() {
  return (
    <g aria-hidden="true">
      <circle
        cx={units(moon.x)}
        cy={units(moon.y)}
        r={units(moon.r)}
        className="design-trip-circle"
      />
      <circle
        cx={units(light.x)}
        cy={units(light.y)}
        r={units(light.r)}
        className="design-trip-circle"
        data-light
      />
      {[moon, light].map((circle) => (
        <circle
          key={circle.r}
          cx={units(circle.x)}
          cy={units(circle.y)}
          r={1.2}
          className="design-trip-point"
        />
      ))}
    </g>
  );
}

function format(value: number, digits = 2): string {
  return value.toFixed(digits);
}

export function LogoGrid() {
  const touches = [
    { x: moon.x, y: corner.y },
    { x: corner.x, y: moon.y },
    { x: light.x, y: corner.y },
    { x: corner.x, y: light.y },
  ];

  return (
    <Plate
      title="The grid and the two circles"
      description="A tile of eight by eight cells with a margin of one cell. The moon, three cells in radius, sits at the tile's centre. The light, two cells in radius, sits one cell up and one cell right of it and breaks the moon's rim. Both circles touch the top and right margin lines."
      viewBox="-12 -12 152 152"
      facts={[
        { label: "Tile", value: `1024 px, 8 cells of ${1024 / 8} px` },
        { label: "Margin", value: "1 cell on every side" },
        { label: "Moon", value: `radius ${moon.r} cells, centre (${moon.x}, ${moon.y})` },
        { label: "Light", value: `radius ${light.r} cells, centre (${light.x}, ${light.y})` },
        {
          label: "Centres apart",
          value: `√2 cells, ${format(apart * 128, 0)} px`,
        },
        {
          label: "Light past the moon's rim",
          value: `${format(apart + light.r - moon.r)} cells, ${format((apart + light.r - moon.r) * 128, 0)} px`,
        },
        { label: "Both touch", value: "the top and the right margin lines" },
      ]}
    >
      <Grid />
      <rect
        x={cell}
        y={cell}
        width={6 * cell}
        height={6 * cell}
        className="design-trip-margin"
        aria-hidden="true"
      />
      <Circles />
      <g aria-hidden="true" className="design-trip-measure">
        <path d={`M ${units(moon.x)} ${units(moon.y)} H ${units(moon.x - moon.r)}`} />
        <path d={`M ${units(light.x)} ${units(light.y)} H ${units(light.x - light.r)}`} />
        <text x={units(moon.x - moon.r / 2)} y={units(moon.y) - 2.5} textAnchor="middle">
          3
        </text>
        <text x={units(light.x - light.r / 2)} y={units(light.y) - 2.5} textAnchor="middle">
          2
        </text>
      </g>
      {touches.map((point) => (
        <circle
          key={`${point.x}-${point.y}`}
          cx={units(point.x)}
          cy={units(point.y)}
          r={1.8}
          className="design-trip-touch"
          aria-hidden="true"
        />
      ))}
    </Plate>
  );
}

export function LogoScaling() {
  const top = units(corner.y) - 7;
  const right = units(corner.x) + 7;

  return (
    <Plate
      title="Two thirds, toward one corner"
      description="The top and right margin lines meet at a point one cell in from the tile's top right corner. Measured from that point, the moon touches each line three cells away and the light two cells away. Its centre sits two thirds of the way along the line from that point to the moon's centre."
      viewBox="-12 -12 152 152"
      facts={[
        { label: "Corner point", value: `(${corner.x}, ${corner.y}), where the margin lines meet` },
        {
          label: "To where each touches",
          value: `moon ${corner.x - moon.x} cells, light ${corner.x - light.x} cells`,
        },
        {
          label: "To each centre",
          value: `moon 3√2 cells, light 2√2 cells`,
        },
        { label: "Light", value: "the moon scaled by 2/3 toward the corner point" },
      ]}
    >
      <Grid />
      <path
        aria-hidden="true"
        className="design-trip-margin"
        d={`M 0 ${units(corner.y)} H ${tile} M ${units(corner.x)} 0 V ${tile}`}
      />
      <Circles />
      <g aria-hidden="true" className="design-trip-measure">
        <path
          d={`M ${units(corner.x)} ${units(corner.y)} L ${units(moon.x)} ${units(moon.y)}`}
          data-ray
        />
        <path d={`M ${units(moon.x)} ${top} H ${units(corner.x)}`} />
        <path d={`M ${units(light.x)} ${top - 6} H ${units(corner.x)}`} data-light />
        <path d={`M ${right} ${units(corner.y)} V ${units(moon.y)}`} />
        <path d={`M ${right + 6} ${units(corner.y)} V ${units(light.y)}`} data-light />
        <text x={units((moon.x + corner.x) / 2)} y={top - 1.5} textAnchor="middle">
          3
        </text>
        <text x={units((light.x + corner.x) / 2)} y={top - 7.5} textAnchor="middle" data-light>
          2
        </text>
        <text x={right - 1.5} y={units((moon.y + corner.y) / 2) + 1.4} textAnchor="end">
          3
        </text>
        <text x={right + 7.5} y={units((light.y + corner.y) / 2) + 1.4} data-light>
          2
        </text>
      </g>
      <circle
        aria-hidden="true"
        cx={units(corner.x)}
        cy={units(corner.y)}
        r={2}
        className="design-trip-touch"
      />
    </Plate>
  );
}

/** The drawings let labels run past their box, so this one cuts its circle to the view by hand. */
export function LogoEdgeReading() {
  const centre = { x: 80, y: 150 };
  const radius = 110;
  const step = 2;
  const angles = Array.from({ length: 21 }, (_, index) => 70 + index * step);

  const at = (degrees: number, distance: number) => ({
    x: centre.x + Math.cos((degrees * Math.PI) / 180) * distance,
    y: centre.y - Math.sin((degrees * Math.PI) / 180) * distance,
  });

  const reading = 90;
  const inside = at(reading, radius - 18);
  const outside = at(reading, radius + 18);
  const id = useId();
  const view = { x: 20, y: 12, width: 120, height: 58 };

  return (
    <Plate
      title="Reading an edge"
      description="A close view of one circle's edge. Small marks along the edge sit two degrees apart. At one of them, a small square patch sits just inside the edge and another just outside, on a line square to the edge."
      viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
      facts={[
        { label: "Picture", value: "the icon as macOS draws it, not the flat colours" },
        { label: "Patches", value: "3 × 3 px, averaged, 26 px either side of the edge" },
        { label: "Readings", value: "every 2° where the edge is on view" },
        { label: "Measure", value: "WCAG contrast ratio, 1 to 21" },
        { label: "Asked of a shape", value: "at least 3" },
      ]}
    >
      <clipPath id={`${id}-view`}>
        <rect {...view} />
      </clipPath>
      <circle
        aria-hidden="true"
        cx={centre.x}
        cy={centre.y}
        r={radius}
        className="design-trip-shape"
        clipPath={`url(#${id}-view)`}
      />
      <g aria-hidden="true" className="design-trip-ticks">
        {angles.map((degrees) => (
          <path
            key={degrees}
            d={`M ${at(degrees, radius - 3).x} ${at(degrees, radius - 3).y} L ${at(degrees, radius + 3).x} ${at(degrees, radius + 3).y}`}
          />
        ))}
      </g>
      <g aria-hidden="true" className="design-trip-measure">
        <path d={`M ${inside.x} ${inside.y} L ${outside.x} ${outside.y}`} />
        <text x={inside.x + 5} y={inside.y + 1.4}>
          inside
        </text>
        <text x={outside.x + 5} y={outside.y + 1.4}>
          outside
        </text>
        {[31, 49].map((y) => (
          <text key={y} x={centre.x - 5} y={y} textAnchor="end">
            26 px
          </text>
        ))}
      </g>
      {[inside, outside].map((point) => (
        <rect
          key={point.y}
          aria-hidden="true"
          x={point.x - 2}
          y={point.y - 2}
          width={4}
          height={4}
          className="design-trip-patch"
        />
      ))}
    </Plate>
  );
}

export function LogoCutTone() {
  const swatches = [
    { color: night.plate[0], label: "plate, top" },
    { color: deepBlue, label: "moon at the cut" },
    { color: night.light, label: "light" },
  ];

  const size = 40;
  const gap = 32;
  const stops = rampStops();
  const id = useId();
  const bar = { y: 64, height: 14, width: 3 * size + 2 * gap };

  return (
    <Plate
      title="The blue at the cut"
      description="Three swatches in a row: the plate's top colour, the moon's deep blue, and the cream light. Below them, a bar shows the moon's gradient, cream up to the light's rim, then deep blue paling to Nyte blue at the moon's far side."
      viewBox="-4 -4 192 96"
      facts={[
        { label: "Plate, top", value: night.plate[0] },
        { label: "Moon at the cut", value: `${deepBlue}, OKLCH 0.609 0.12 268.2` },
        { label: "Light", value: night.light },
        {
          label: "Contrast, light to blue",
          value: format(contrast(night.light, deepBlue)),
        },
        {
          label: "Contrast, blue to plate",
          value: format(contrast(deepBlue, night.plate[0])),
        },
        { label: "Moon's far side", value: `${nyteBlue}, the old icon's blue` },
        {
          label: "Gradient",
          value: `rings round the light's centre, from its rim at ${format(stops[0].offset, 3)} of the way out`,
        },
      ]}
    >
      <defs>
        <linearGradient id={`${id}-ramp`}>
          <stop offset={0} stopColor={night.light} />
          <stop offset={stops[0].offset} stopColor={night.light} />
          {stops.map((stop) => (
            <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />
          ))}
        </linearGradient>
      </defs>
      {swatches.map((swatch, index) => (
        <g key={swatch.color} aria-hidden="true">
          <rect
            x={index * (size + gap)}
            y={0}
            width={size}
            height={size}
            fill={swatch.color}
            className="design-trip-swatch"
          />
        </g>
      ))}
      <g aria-hidden="true" className="design-trip-measure">
        <text x={size + gap / 2} y={size / 2 + 1.4} textAnchor="middle">
          {format(contrast(deepBlue, night.plate[0]))}
        </text>
        <text x={2 * size + gap * 1.5} y={size / 2 + 1.4} textAnchor="middle">
          {format(contrast(night.light, deepBlue))}
        </text>
      </g>
      <rect
        aria-hidden="true"
        x={0}
        y={bar.y}
        width={bar.width}
        height={bar.height}
        fill={`url(#${id}-ramp)`}
        className="design-trip-swatch"
      />
      <g aria-hidden="true" className="design-trip-axis" data-start>
        <text x={0} y={bar.y + bar.height + 6}>
          light's centre
        </text>
        <text x={bar.width * stops[0].offset} y={bar.y + bar.height + 6} textAnchor="middle">
          rim
        </text>
        <text x={bar.width} y={bar.y + bar.height + 6} textAnchor="end">
          moon's far side
        </text>
      </g>
    </Plate>
  );
}

export function LogoOneInk() {
  const panels = [
    {
      ground: night.plate[1],
      ink: nyteBlue,
      moon: 0.47,
      light: 1,
      label: "on a dark ground",
    },
    {
      ground: "#ffffff",
      ink: night.plate[0],
      moon: 1,
      light: 0.58,
      label: "on a light ground",
    },
  ];

  const path = crescentPath();

  return (
    <Plate
      title="One ink"
      description="Two panels. On a dark panel, the mark in pale blue with the moon dimmed and the light at full strength. On a white panel, the mark in navy with the moon at full strength and the light thinned."
      viewBox="0 0 264 128"
      facts={[
        { label: "Dark ground", value: "moon at 47%, light at full strength" },
        {
          label: "Moon tone, by contrast",
          value: `${format(contrastOver(nyteBlue, night.plate[1], 0.47, nyteBlue))} from the light, ${format(contrastOver(nyteBlue, night.plate[1], 0.47, night.plate[1]))} from the ground`,
        },
        { label: "Light ground", value: "moon at full strength, light at 58%" },
        {
          label: "Light tone, by contrast",
          value: `${format(contrastOver(night.plate[0], "#ffffff", 0.58, night.plate[0]))} from the moon, ${format(contrastOver(night.plate[0], "#ffffff", 0.58, "#ffffff"))} from the ground`,
        },
        { label: "Rule", value: "the light is always the lighter shape" },
      ]}
    >
      {panels.map((panel, index) => (
        <g key={panel.label} transform={`translate(${index * (tile + 8)} 0)`} aria-hidden="true">
          <rect width={tile} height={tile} fill={panel.ground} className="design-trip-swatch" />
          <path d={path} fill={panel.ink} opacity={panel.moon} />
          <circle
            cx={units(light.x)}
            cy={units(light.y)}
            r={units(light.r)}
            fill={panel.ink}
            opacity={panel.light}
          />
        </g>
      ))}
    </Plate>
  );
}

export function LogoShadow() {
  const id = useId();
  const ring = shadowRing();
  const stops = rampStops();
  const edge = units(light.x - light.r);
  const depth = units(light.x - light.r + shadow.reach);

  return (
    <Plate
      title="The shadow on the light"
      description="The night tile drawn flat and large. Along the left edge of the cream light, where the moon's edge lies over it, a soft dark shadow is deepest at nine o'clock and thins to nothing toward twelve and six."
      viewBox="0 0 128 128"
      facts={[
        { label: "Strength", value: `${shadow.strength} at the moon's edge` },
        {
          label: "Reach",
          value: `${shadow.reach} cells across the light at its deepest, ${format(shadow.reach * 128, 1)} px`,
        },
        { label: "Deepest", value: `at ${shadow.hour} o'clock on the light's rim` },
        {
          label: "Fade",
          value:
            "from nothing at its inner edge to full strength at the moon's, on a curve of power 1.5",
        },
        { label: "Drawn", value: "only where the light lies inside the moon's circle" },
        { label: "Colour", value: `${night.plate[1]}, the plate's bottom` },
      ]}
    >
      <defs>
        <linearGradient id={`${id}-plate`} x1={0} y1={0} x2={0} y2={1}>
          <stop offset={0} stopColor={night.plate[0]} />
          <stop offset={1} stopColor={night.plate[1]} />
        </linearGradient>
        <radialGradient
          id={`${id}-ramp`}
          gradientUnits="userSpaceOnUse"
          cx={units(light.x)}
          cy={units(light.y)}
          r={units(apart + moon.r)}
        >
          {stops.map((stop) => (
            <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />
          ))}
        </radialGradient>
        <radialGradient
          id={`${id}-fall`}
          gradientUnits="userSpaceOnUse"
          cx={units(ring.x)}
          cy={units(ring.y)}
          r={units(ring.r)}
        >
          {ring.stops.map((stop) => (
            <stop
              key={stop.offset}
              offset={stop.offset}
              stopColor={night.plate[1]}
              stopOpacity={stop.opacity}
            />
          ))}
        </radialGradient>
        <clipPath id={`${id}-light`}>
          <circle cx={units(light.x)} cy={units(light.y)} r={units(light.r)} />
        </clipPath>
        <clipPath id={`${id}-moon`}>
          <circle cx={units(moon.x)} cy={units(moon.y)} r={units(moon.r)} />
        </clipPath>
      </defs>
      <g aria-hidden="true">
        <rect width={tile} height={tile} rx={tile * tileCorner} fill={`url(#${id}-plate)`} />
        <circle cx={units(moon.x)} cy={units(moon.y)} r={units(moon.r)} fill={`url(#${id}-ramp)`} />
        <circle cx={units(light.x)} cy={units(light.y)} r={units(light.r)} fill={night.light} />
        <g clipPath={`url(#${id}-moon)`}>
          <circle
            cx={units(ring.x)}
            cy={units(ring.y)}
            r={units(ring.r)}
            fill={`url(#${id}-fall)`}
            clipPath={`url(#${id}-light)`}
          />
        </g>
      </g>
      <g
        aria-hidden="true"
        className="design-trip-callout"
        stroke={night.plate[1]}
        fill={night.plate[1]}
      >
        <path d={`M ${edge} ${units(light.y)} H ${depth}`} />
        <path d={`M ${edge} ${units(light.y) - 3} V ${units(light.y) + 3}`} />
        <path d={`M ${depth} ${units(light.y) - 3} V ${units(light.y) + 3}`} />
        <text x={depth + 3} y={units(light.y) + 1.4} stroke="none">
          {shadow.reach} cells
        </text>
      </g>
    </Plate>
  );
}
