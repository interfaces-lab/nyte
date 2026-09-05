import { activate } from "/Users/workgyver/Developer/nyte/packages/core/src/kernel/sdk/activation.ts";
import {
  inlinePlugin,
  definePlugin,
} from "/Users/workgyver/Developer/nyte/packages/core/src/plugins/types.ts";
const make = (id, text) =>
  inlinePlugin(
    definePlugin({
      id,
      session(api) {
        api.prompt.add((draft) => draft.set("shared", { text }));
        api.hook("before_tool", () => ({ action: "modify", args: { value: text } }));
      },
    }),
  );
const a = make("a", "A");
const b = make("b", "B");
const activation = await activate({
  target: { kind: "new-session" },
  plugins: [a, b],
  env: { cwd: process.cwd() },
});
const inspect = async () => ({
  order: activation.plugins.list().map((plugin) => plugin.id),
  prompt: activation.systemPrompt(),
  hook: await activation.hooks.run("before_tool", {
    head: "main",
    runId: "run",
    toolCallId: "call",
    toolName: "demo",
    args: {},
  }),
});
console.log("before", await inspect());
await activation.setPlugins([b, a]);
console.log("after reorder", await inspect());
await activation.setPlugins([a, b]);
await activation.setPlugins([{ ...a, version: "updated" }, b]);
console.log("after reload A first", await inspect());
await activation.close();
