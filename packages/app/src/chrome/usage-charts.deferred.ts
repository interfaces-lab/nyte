import { BarChart, Sparkline } from "@nyte-ai/ui/chart";
import { publishDeferred } from "../deferred.tsx";

/** The usage page's nivo charts. */
export const chartsRuntime = { BarChart, Sparkline };

publishDeferred("charts", chartsRuntime);
