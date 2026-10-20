import { BarChart, Sparkline } from "@nyte-ai/ui/chart";
import { publishDeferred } from "../deferred.tsx";

export const chartsRuntime = { BarChart, Sparkline };

publishDeferred("charts", chartsRuntime);
