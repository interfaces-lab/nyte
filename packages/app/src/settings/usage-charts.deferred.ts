import { BarChart, Sparkline } from "@nyte-ai/ui/chart";
import { publishDeferred } from "../lib/deferred.tsx";

export const chartsRuntime = { BarChart, Sparkline };

publishDeferred("charts", chartsRuntime);
