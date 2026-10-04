import { start } from "workflow/api";
import { createVercelDispatcher } from "@nyte-ai/vercel";
import { runSession } from "../workflows/session.ts";
import { openExecution } from "./runtime.ts";

export const wakeSession = createVercelDispatcher({
  workflow: runSession,
  openExecution,
  startWorkflow: start,
});
