/**
 * What every client folds on its side of the SDK: one head's state from a
 * snapshot and the events that follow it, and the observer that keeps it
 * current. Renderer-free, so a terminal, a desktop window, and a headless
 * runner share one fold.
 */
export {
  foldEvent,
  stateFromSnapshot,
  stateWithMetadata,
  tipMismatch,
  waitingCall,
  type FoldOutcome,
  type SessionState,
  type WaitingCall,
} from "./client/session-state.ts";
export {
  SessionObserver,
  type SessionObserverClient,
  type SessionObserverOptions,
  type SessionUpdate,
} from "./client/session-follow.ts";

export { sessionMark, type SessionMark } from "./client/session-status.ts";
