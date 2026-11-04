import type { ReactElement } from "react";
import { BarChart, Sparkline } from "@nyte-ai/ui/chart";
import type { BarChartProps, SparklineProps } from "@nyte-ai/ui/chart";

type Bare<Props> = Omit<Props, "className" | "style" | "xstyle">;

export function StackedBars(props: Bare<BarChartProps>): ReactElement {
  return <BarChart {...props} />;
}

export function Spark(props: Bare<SparklineProps>): ReactElement {
  return <Sparkline {...props} />;
}
