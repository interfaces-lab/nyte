import { useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";

export interface ChartDatum {
  readonly label: string;
  readonly value: number;
}

interface ChartProps {
  readonly data: readonly ChartDatum[];
  readonly height?: number;
  readonly title?: string;
}

const series = (index: number): string => `var(--canvas-chart-${(index % 6) + 1})`;

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

const exact = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

const TICK_FONT = 11;

const CHAR_WIDTH = 6.4;

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;

    if (element === null) return undefined;

    setWidth(Math.floor(element.clientWidth));

    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWidth(Math.floor(entry.contentRect.width));
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}

/** Round ticks covering low..high: steps of 1, 2, 2.5 or 5 times a power of ten. */
function niceTicks(low: number, high: number, count = 4) {
  const span = high - low || Math.abs(high) || 1;
  const rough = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? rough;
  const min = Math.floor(low / step) * step;
  const max = Math.max(min + step, Math.ceil(high / step) * step);
  const values: number[] = [];

  for (let value = min; value <= max + step / 2; value += step)
    values.push(Number(value.toPrecision(12)));

  return { values, min, max };
}

function Plot({
  title,
  height,
  children,
}: {
  readonly title: string;
  readonly height: number;
  readonly children: (width: number) => ReactNode;
}): ReactElement {
  const [ref, width] = useWidth();

  return (
    <div ref={ref} style={{ width: "100%", height }}>
      {width > 0 && (
        <svg
          role="img"
          aria-label={title}
          width={width}
          height={height}
          style={{ display: "block", overflow: "visible", fontSize: TICK_FONT }}
        >
          <title>{title}</title>
          {children(width)}
        </svg>
      )}
    </div>
  );
}

function Empty({ height }: { readonly height: number }): ReactElement {
  return (
    <div
      style={{
        display: "grid",
        placeItems: "center",
        height,
        color: "var(--canvas-subtle)",
      }}
    >
      No data
    </div>
  );
}

function Axis({
  ticks,
  y,
  left,
  right,
}: {
  readonly ticks: readonly number[];
  readonly y: (value: number) => number;
  readonly left: number;
  readonly right: number;
}): ReactElement {
  return (
    <g>
      {ticks.map((tick) => {
        const at = Math.round(y(tick)) + 0.5;

        return (
          <g key={tick}>
            <line
              x1={left}
              x2={right}
              y1={at}
              y2={at}
              stroke={tick === 0 ? "var(--canvas-border)" : "var(--canvas-grid)"}
            />
            <text
              x={left - 10}
              y={at}
              textAnchor="end"
              dominantBaseline="central"
              fill="var(--canvas-subtle)"
            >
              {compact.format(tick)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function axisWidth(ticks: readonly number[]): number {
  return Math.max(...ticks.map((tick) => compact.format(tick).length)) * CHAR_WIDTH + 14;
}

/** Every nth label, so labels never collide at narrow widths. */
function labelStride(labels: readonly string[], slot: number): number {
  const widest = Math.max(1, ...labels.map((label) => label.length)) * CHAR_WIDTH + 12;

  return Math.max(1, Math.ceil(widest / Math.max(1, slot)));
}

function barPath(x: number, top: number, width: number, bottom: number, radius: number): string {
  const height = bottom - top;

  if (height <= 0) return "";
  const r = Math.min(radius, width / 2, height);

  return `M${x},${bottom}V${top + r}Q${x},${top} ${x + r},${top}H${x + width - r}Q${x + width},${top} ${x + width},${top + r}V${bottom}Z`;
}

export function BarChart({ data, height = 240, title = "Bar chart" }: ChartProps): ReactElement {
  const [active, setActive] = useState<number>();

  if (data.length === 0) return <Empty height={height} />;

  const values = data.map((item) => item.value);
  const scale = niceTicks(Math.min(0, ...values), Math.max(0, ...values));

  return (
    <Plot title={title} height={height}>
      {(width) => {
        const left = axisWidth(scale.values);
        const top = 20;
        const bottom = height - 26;

        const y = (value: number): number =>
          bottom - ((value - scale.min) / (scale.max - scale.min)) * (bottom - top);

        const slot = (width - left) / data.length;
        const barWidth = Math.min(56, slot * 0.62);

        const stride = labelStride(
          data.map((item) => item.label),
          slot,
        );

        return (
          <>
            <Axis ticks={scale.values} y={y} left={left} right={width} />
            {data.map((item, index) => {
              const center = left + slot * (index + 0.5);
              const zero = y(0);
              const end = y(item.value);
              const dimmed = active !== undefined && active !== index;

              return (
                <g
                  key={`${index}:${item.label}`}
                  onMouseEnter={() => setActive(index)}
                  onMouseLeave={() => setActive(undefined)}
                  style={{ transition: "opacity 120ms ease-out", opacity: dimmed ? 0.4 : 1 }}
                >
                  <rect
                    x={left + slot * index}
                    y={top}
                    width={slot}
                    height={bottom - top}
                    fill="transparent"
                  />
                  <path
                    d={
                      item.value >= 0
                        ? barPath(center - barWidth / 2, end, barWidth, zero, 4)
                        : barPath(center - barWidth / 2, zero, barWidth, end, 0)
                    }
                    fill={series(0)}
                  >
                    <title>{`${item.label}: ${exact.format(item.value)}`}</title>
                  </path>
                  <text
                    x={center}
                    y={item.value >= 0 ? end - 7 : end + 14}
                    textAnchor="middle"
                    fill="var(--canvas-fg)"
                    style={{ fontWeight: 500 }}
                  >
                    {compact.format(item.value)}
                  </text>
                  {(index % stride === 0 || active === index) && (
                    <text x={center} y={height - 6} textAnchor="middle" fill="var(--canvas-muted)">
                      {item.label}
                    </text>
                  )}
                </g>
              );
            })}
          </>
        );
      }}
    </Plot>
  );
}

export function LineChart({
  data,
  height = 240,
  title = "Line chart",
  area = false,
  points = true,
}: ChartProps & { readonly area?: boolean; readonly points?: boolean }): ReactElement {
  const gradient = useId();
  const [active, setActive] = useState<number>();

  if (data.length === 0) return <Empty height={height} />;

  const values = data.map((item) => item.value);
  const scale = niceTicks(Math.min(...values), Math.max(...values));

  return (
    <Plot title={title} height={height}>
      {(width) => {
        const left = axisWidth(scale.values);
        const right = width - 12;
        const top = 20;
        const bottom = height - 26;
        const inset = 8;

        const x = (index: number): number =>
          data.length === 1
            ? (left + right) / 2
            : left + inset + (index * (right - left - inset * 2)) / (data.length - 1);

        const y = (value: number): number =>
          bottom - ((value - scale.min) / (scale.max - scale.min)) * (bottom - top);

        const line = data
          .map((item, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(item.value)}`)
          .join("");
        const slot = (right - left) / data.length;

        const stride = labelStride(
          data.map((item) => item.label),
          slot,
        );

        const shown = active ?? data.length - 1;
        const focus = data[shown];

        return (
          <>
            <defs>
              <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={series(0)} stopOpacity={0.24} />
                <stop offset="100%" stopColor={series(0)} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Axis ticks={scale.values} y={y} left={left} right={width} />
            {area && (
              <path
                d={`${line}L${x(data.length - 1)},${bottom}L${x(0)},${bottom}Z`}
                fill={`url(#${gradient})`}
              />
            )}
            {active !== undefined && (
              <line
                x1={x(active)}
                x2={x(active)}
                y1={top}
                y2={bottom}
                stroke="var(--canvas-border)"
                strokeDasharray="3 3"
              />
            )}
            <path
              d={line}
              fill="none"
              stroke={series(0)}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {data.map((item, index) => (
              <g key={`${index}:${item.label}`}>
                {(points || index === shown) && (
                  <circle
                    cx={x(index)}
                    cy={y(item.value)}
                    r={index === shown ? 4.5 : 3}
                    fill={index === shown ? series(0) : "var(--canvas-surface)"}
                    stroke={index === shown ? "var(--canvas-surface)" : series(0)}
                    strokeWidth={index === shown ? 2 : 1.5}
                  />
                )}
                {(index % stride === 0 || index === active) && (
                  <text x={x(index)} y={height - 6} textAnchor="middle" fill="var(--canvas-muted)">
                    {item.label}
                  </text>
                )}
                <rect
                  x={x(index) - slot / 2}
                  y={top}
                  width={slot}
                  height={bottom - top}
                  fill="transparent"
                  onMouseEnter={() => setActive(index)}
                  onMouseLeave={() => setActive(undefined)}
                >
                  <title>{`${item.label}: ${exact.format(item.value)}`}</title>
                </rect>
              </g>
            ))}
            {focus !== undefined && (
              <text
                x={x(shown)}
                y={y(focus.value) - 11}
                textAnchor={shown === data.length - 1 && data.length > 1 ? "end" : "middle"}
                fill="var(--canvas-fg)"
                style={{ fontWeight: 500, pointerEvents: "none" }}
              >
                {exact.format(focus.value)}
              </text>
            )}
          </>
        );
      }}
    </Plot>
  );
}

function arcPath(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  start: number,
  end: number,
): string {
  const point = (radius: number, angle: number) =>
    `${cx + radius * Math.sin(angle)},${cy - radius * Math.cos(angle)}`;

  const large = end - start > Math.PI ? 1 : 0;

  if (inner <= 0)
    return `M${cx},${cy}L${point(outer, start)}A${outer},${outer} 0 ${large} 1 ${point(outer, end)}Z`;

  return `M${point(outer, start)}A${outer},${outer} 0 ${large} 1 ${point(outer, end)}L${point(inner, end)}A${inner},${inner} 0 ${large} 0 ${point(inner, start)}Z`;
}

export function PieChart({
  data,
  height = 240,
  title = "Pie chart",
  innerRadius = 0,
}: ChartProps & { readonly innerRadius?: number }): ReactElement {
  const [active, setActive] = useState<number>();
  const positive = data.map((item) => Math.max(0, item.value));
  const total = positive.reduce((sum, value) => sum + value, 0);

  if (total === 0) return <Empty height={height} />;

  const size = height;
  const outer = size / 2 - 4;
  const inner = Math.min(outer - 8, Math.max(0, innerRadius));
  // A whole slice cannot be one arc, and a single slice needs no gap.
  const pad = positive.filter((value) => value > 0).length > 1 ? 1.5 / outer : 0;

  const slices = positive.map((value, index) => {
    const before = positive.slice(0, index).reduce((sum, item) => sum + item, 0);
    const start = (before / total) * Math.PI * 2;
    const sweep = (value / total) * Math.PI * 2;
    const from = start + pad / 2;

    return {
      index,
      value,
      from,
      to: sweep >= Math.PI * 2 ? from + Math.PI * 2 - 0.0001 : start + sweep - pad / 2,
    };
  });

  const focus = active === undefined ? undefined : data[active];

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 28, flexWrap: "wrap" }}>
      <svg
        role="img"
        aria-label={title}
        width={size}
        height={size}
        style={{ display: "block", flexShrink: 0 }}
      >
        <title>{title}</title>
        {slices.map((slice) =>
          slice.to > slice.from ? (
            <path
              key={slice.index}
              d={arcPath(size / 2, size / 2, outer, inner, slice.from, slice.to)}
              fill={series(slice.index)}
              onMouseEnter={() => setActive(slice.index)}
              onMouseLeave={() => setActive(undefined)}
              style={{
                transition: "opacity 120ms ease-out",
                opacity: active !== undefined && active !== slice.index ? 0.4 : 1,
              }}
            >
              <title>{`${data[slice.index]?.label ?? ""}: ${exact.format(slice.value)}`}</title>
            </path>
          ) : null,
        )}
        {inner > 24 && (
          <g style={{ pointerEvents: "none" }}>
            <text
              x={size / 2}
              y={size / 2 - 2}
              textAnchor="middle"
              fill="var(--canvas-fg)"
              style={{ fontSize: 20, fontWeight: 600 }}
            >
              {compact.format(focus === undefined ? total : focus.value)}
            </text>
            <text x={size / 2} y={size / 2 + 16} textAnchor="middle" fill="var(--canvas-subtle)">
              {focus === undefined ? "Total" : focus.label}
            </text>
          </g>
        )}
      </svg>
      <ul
        style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8, minWidth: 160 }}
      >
        {data.map((item, index) => (
          <li
            key={`${index}:${item.label}`}
            onMouseEnter={() => setActive(index)}
            onMouseLeave={() => setActive(undefined)}
            style={{
              display: "grid",
              gridTemplateColumns: "8px 1fr auto auto",
              alignItems: "center",
              columnGap: 10,
              opacity: active !== undefined && active !== index ? 0.5 : 1,
              transition: "opacity 120ms ease-out",
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: 2, background: series(index) }} />
            <span style={{ color: "var(--canvas-muted)" }}>{item.label}</span>
            <span style={{ color: "var(--canvas-fg)", fontWeight: 500 }}>
              {exact.format(item.value)}
            </span>
            <span style={{ color: "var(--canvas-subtle)", minWidth: 36, textAlign: "end" }}>
              {Math.round(((positive[index] ?? 0) / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
