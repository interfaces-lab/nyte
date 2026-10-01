/**
 * Transcript replay helpers live in @nyte-ai/schema so clients share one
 * reading of system messages; re-exported here for the ai layout.
 */
export {
  collapseSystemMessages,
  createInitialSystemMessage,
  declarationsEqual,
  getCurrentSystemMessage,
  getCurrentSystemPrompt,
  getCurrentTools,
  getDeclaredTools,
  getInitialSystemMessage,
  getToolStateChanges,
  hasNonAdditiveToolChanges,
  hasToolRedefinitions,
  normalizeContext,
  resolveTranscript,
  resolveTranscriptTools,
  toToolDeclaration,
  withoutInitialSystemMessage,
  type ToolStateChanges,
  type TranscriptContext,
  type TranscriptMessages,
  type TranscriptTools,
} from "@nyte-ai/schema";
