import { fileURLToPath } from "node:url";
import { normalizePath, type Plugin } from "vite";

const entry = normalizePath(fileURLToPath(new URL("./src/account/clerk.tsx", import.meta.url)));

const virtualId = "virtual:nyte-clerk-entry";

export function deferredClerk(): Plugin {
  let development = false;

  return {
    name: "nyte:deferred-clerk",
    configResolved(config) {
      development = config.command === "serve";
    },
    resolveId(id) {
      if (id === virtualId) return `\0${virtualId}`;
    },
    load(id) {
      if (id !== `\0${virtualId}`) return;

      if (development) return `export default ${JSON.stringify(`/@fs/${entry}`)};`;
      const reference = this.emitFile({ type: "chunk", id: entry, name: "clerk" });

      return `export default import.meta.ROLLUP_FILE_URL_${reference};`;
    },
    generateBundle(_options, bundle) {
      const startup = Object.values(bundle)
        .filter(
          (output) => output.type === "chunk" && output.isEntry && output.facadeModuleId !== entry,
        )
        .map((output) => output.fileName);

      const visited = new Set<string>();

      for (const file of startup) {
        if (visited.has(file)) continue;
        visited.add(file);
        const chunk = bundle[file];

        if (chunk?.type !== "chunk") continue;

        if (Object.keys(chunk.modules).some((id) => id.includes("/node_modules/@clerk/"))) {
          this.error("Clerk must stay out of the renderer startup imports");
        }

        startup.push(...chunk.imports);
      }
    },
  };
}
