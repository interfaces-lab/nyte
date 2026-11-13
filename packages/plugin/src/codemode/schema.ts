import { standard } from "@nyte-ai/schema";
import { Type } from "typebox";

/** Declared only while some tool is exposed to code, such as an MCP server's: without one, a script has nothing to call that a direct tool call can't. */
export const CODEMODE_TOOL = "codemode";

export const codemodeParameters = standard(
  Type.Object({ code: Type.String({ description: "Raw JavaScript source." }) }),
);
