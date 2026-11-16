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
import type { Json } from "@nyte-ai/schema";
import { Type } from "typebox";

function checkOnly<V extends { readonly Check: unknown }>(validator: V): Pick<V, "Check"> {
  return validator;
}

export const welcomes = checkOnly(compile(withJson(WelcomeFrameType)));

export const results = checkOnly(
  compile(Type.Object({ ...ResultFrameType.properties, output: Type.Unsafe<Json>({}) })),
);

export const errors = checkOnly(compile(withJson(ErrorFrameType)));

export const events = checkOnly(compile(withJson(EventFrameType)));

export const texts = checkOnly(compile(withJson(TextFrameType)));

export const fragments = checkOnly(compile(withJson(FragmentFrameType)));
