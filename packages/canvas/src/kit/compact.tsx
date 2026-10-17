import type { ReactElement } from "react";
import { BarChart, Sparkline } from "@nyte-ai/ui/chart";
import type { BarChartProps, SparklineProps } from "@nyte-ai/ui/chart";

type Bare<Props> = Omit<Props, "className" | "style" | "xstyle">;

/** The ui stacked bars for figures beside their numbers: no axes, a readout on pointer or arrow keys. */
export function StackedBars(props: Bare<BarChartProps>): ReactElement {
  return <BarChart {...props} />;
}

/** The ui sparkline: a row's trend, scaled to its own peak. */
export function Spark(props: Bare<SparklineProps>): ReactElement {
  return <Sparkline {...props} />;
}
