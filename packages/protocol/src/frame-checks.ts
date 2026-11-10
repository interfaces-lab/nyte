import {
  compile,
  ErrorFrameType,
  EventFrameType,
  FragmentFrameType,
  ResultFrameType,
  TextFrameType,
  WelcomeFrameType,
  withJson,
} from "@nyte-ai/schema";

/**
 * The socket's frame validators, checked on every frame. The compiled binary's build replaces this
 * module with the same checks generated ahead of time, which have only `Check`.
 */
function checkOnly<V extends { readonly Check: unknown }>(validator: V): Pick<V, "Check"> {
  return validator;
}

export const welcomes = checkOnly(compile(withJson(WelcomeFrameType)));

export const results = checkOnly(compile(withJson(ResultFrameType)));

export const errors = checkOnly(compile(withJson(ErrorFrameType)));

export const events = checkOnly(compile(withJson(EventFrameType)));

export const texts = checkOnly(compile(withJson(TextFrameType)));

export const fragments = checkOnly(compile(withJson(FragmentFrameType)));
