import {
  ActivationType,
  ClientRowType,
  ClosingEventType,
  compile,
  PerformEventType,
  SessionChangeType,
  SessionsChangeType,
  withJson,
} from "@nyte-ai/schema";

function checkOnly<V extends { readonly Check: unknown }>(validator: V): Pick<V, "Check"> {
  return validator;
}

export const sessionChanges = checkOnly(compile(withJson(SessionChangeType)));

export const sessionsChanges = checkOnly(compile(withJson(SessionsChangeType)));

export const activations = checkOnly(compile(withJson(ActivationType)));

export const clientRows = checkOnly(compile(withJson(ClientRowType)));

export const performs = checkOnly(compile(withJson(PerformEventType)));

export const closings = checkOnly(compile(ClosingEventType));
