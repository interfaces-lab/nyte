/**
 * The coding tool set as a plugin. `src/tools` is a library of tool
 * implementations; this is the only place that puts them in front of the model.
 * `safe` replay marks tools that can re-run after a crash; the rest settle as
 * an error on resume.
 */
import { createBashToolDefinition } from "../../tools/bash.ts";
import { createEditToolDefinition } from "../../tools/edit.ts";
import { createReadToolDefinition } from "../../tools/read.ts";
import { createWriteToolDefinition } from "../../tools/write.ts";
import { definePlugin } from "../types.ts";

export function toolsFsPlugin() {
  return definePlugin({
    id: "tools-fs",
    session(api) {
      api.tools.add("read", { ...createReadToolDefinition(), replay: "safe" });
      api.tools.add("bash", { ...createBashToolDefinition(), replay: "never" });
      api.tools.add("edit", { ...createEditToolDefinition(), replay: "never" });
      api.tools.add("write", { ...createWriteToolDefinition(), replay: "never" });
      api.prompt.add((draft) =>
        draft.set("cwd", { text: `Current working directory: ${api.env.cwd}` }),
      );
    },
  });
}
