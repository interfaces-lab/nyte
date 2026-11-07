import { Type } from "typebox";

export const TokenCount = Type.Integer({ minimum: 0 });

export const NullableTokenCount = Type.Optional(Type.Union([TokenCount, Type.Null()]));
