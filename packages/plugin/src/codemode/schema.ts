import { standard } from "@nyte-ai/schema";
import { Type } from "typebox";

export const CODEMODE_TOOL = "codemode";

export const codemodeParameters = standard(
  Type.Object({ code: Type.String({ description: "Raw JavaScript source." }) }),
);
