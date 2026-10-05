/**
 * The modules a user plugin may import by bare specifier without installing
 * anything. Loaders map each to the host's own instance, so a plugin under
 * `~/.nyte/plugins` resolves them with no `node_modules` ancestor, and
 * `instanceof` checks hold across the boundary. The packaged desktop app and
 * the compiled TUI ship no `node_modules` for workspace packages, so this
 * table is the only path to them.
 */
import * as ai from "@nyte-ai/ai";
import * as pluginApi from "@nyte-ai/plugin";
import * as provider from "@nyte-ai/plugin/provider";
import * as schema from "@nyte-ai/schema";
import * as typebox from "typebox";
import * as typeboxCompile from "typebox/compile";
import * as typeboxValue from "typebox/value";

export const hostModules: Readonly<Record<string, object>> = {
  "@nyte-ai/ai": ai,
  "@nyte-ai/core/plugins": pluginApi,
  "@nyte-ai/plugin": pluginApi,
  "@nyte-ai/plugin/provider": provider,
  "@nyte-ai/schema": schema,
  typebox,
  "typebox/compile": typeboxCompile,
  "typebox/value": typeboxValue,
};
