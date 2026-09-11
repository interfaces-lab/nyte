/** Browser-safe client projections. */
export * from "./kernel/views/index.ts";
export * from "./completion-trigger.ts";
export type { MentionFile } from "./mention-files.ts";
export {
  parsePatchFacts,
  type ParsedPatch,
  type PatchFile,
  type PatchStat,
} from "./kernel/views/patch.ts";
export { isTerminalPhase } from "@nyte-ai/protocol";
