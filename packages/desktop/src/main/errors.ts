import { Type } from "typebox";
import { Value } from "typebox/value";

const errnoException = Type.Object({ code: Type.String() });

/** Node's errno code on a thrown value, when it carries one. */
export function errorCode(cause: unknown): string | undefined {
  return Value.Check(errnoException, cause) ? cause.code : undefined;
}
