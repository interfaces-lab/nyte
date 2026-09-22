import { Type } from "typebox";

/** A provider token count. */
export const TokenCount = Type.Integer({ minimum: 0 });

/** A token count a provider may also send as `null` or leave out. */
export const NullableTokenCount = Type.Optional(Type.Union([TokenCount, Type.Null()]));
