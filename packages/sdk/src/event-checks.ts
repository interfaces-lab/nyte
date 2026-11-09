import {
  ActivationType,
  ClientRowType,
  compile,
  PerformEventType,
  SessionChangeType,
  SessionsChangeType,
  withJson,
} from "@nyte-ai/schema";

/**
 * Validators for the host's live events. The compiled binary's build replaces this module with the
 * same checks generated ahead of time, which have only `Check`.
 */
function checkOnly<V extends { readonly Check: unknown }>(validator: V): Pick<V, "Check"> {
  return validator;
}

export const sessionChanges = checkOnly(compile(withJson(SessionChangeType)));

export const sessionsChanges = checkOnly(compile(withJson(SessionsChangeType)));

export const activations = checkOnly(compile(withJson(ActivationType)));

export const clientRows = checkOnly(compile(withJson(ClientRowType)));

export const performs = checkOnly(compile(withJson(PerformEventType)));
