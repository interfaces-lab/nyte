import type { Plugin } from "vite";

export { stylex } from "@nyte-ai/ui/stylex";

export function dropInlinedGhosttyWasm(): Plugin {
  const inlinedWasm = /"data:application\/wasm;base64,[A-Za-z0-9+/=]+"/u;

  return {
    name: "nyte:drop-inlined-ghostty-wasm",
    apply: "build",
    transform(code, id) {
      if (!id.split("?")[0]?.endsWith("/ghostty-web/dist/ghostty-web.js")) return null;

      if (!inlinedWasm.test(code)) {
        this.error("ghostty-web no longer inlines its wasm; remove dropInlinedGhosttyWasm");
      }

      return { code: code.replace(inlinedWasm, '""'), map: null };
    },
  };
}
