import { TOOL_CALLS } from "../suites/tool-calls/cases.ts";
import type { Suite } from "./case.ts";

/** Every Nyte Bench suite, in the order a run reports them. */
export const SUITES: readonly Suite[] = [TOOL_CALLS];
