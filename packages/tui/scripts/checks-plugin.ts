import { fileURLToPath } from "node:url";
import {
  errors,
  events,
  fragments,
  results,
  texts,
  welcomes,
} from "@nyte-ai/protocol/frame-checks";
import {
  activations,
  clientRows,
  performs,
  sessionChanges,
  sessionsChanges,
} from "@nyte-ai/sdk/event-checks";
import type { BunPlugin } from "bun";
import { Code, Validator } from "typebox/compile";

const RUNTIME_IMPORT = /^import \{ (\w+) \} from "(typebox\/\w+)"$/u;

const CHECKS = {
  "frame-checks.ts": { welcomes, results, errors, events, texts, fragments },
  "event-checks.ts": { sessionChanges, sessionsChanges, activations, clientRows, performs },
} as const;

export const checksPlugin = {
  name: "nyte:checks",
  setup(build) {
    build.onLoad({ filter: /[/\\](?:frame|event)-checks\.ts$/ }, (args) => {
      const file = args.path.split(/[/\\]/u).at(-1);
      const checks = file === "frame-checks.ts" || file === "event-checks.ts" ? CHECKS[file] : null;

      if (checks === null) throw new Error(`${args.path} has no checks listed for generation.`);
      const runtime = new Map<string, string>();

      const exports = Object.entries(checks).map(([name, validator]) => {
        if (!(validator instanceof Validator)) {
          throw new Error(`${args.path} exports ${name}, which isn't a TypeBox validator.`);
        }

        return `export const ${name} = (() => {\n${standalone(validator, runtime, args.path)}\nreturn { Check };\n})();`;
      });

      const imports = [...runtime].map(
        ([binding, specifier]) =>
          `import { ${binding} } from ${JSON.stringify(fileURLToPath(import.meta.resolve(specifier)))};`,
      );

      return { contents: [...imports, ...exports].join("\n"), loader: "js" };
    });
  },
} satisfies BunPlugin;

function standalone(validator: Validator, runtime: Map<string, string>, path: string): string {
  const generated = Code(validator.Context(), validator.Type());

  const lines = generated.Code.split("\n").filter((line) => {
    const imported = RUNTIME_IMPORT.exec(line);

    if (imported === null) return true;
    runtime.set(imported[1] ?? "", imported[2] ?? "");

    return false;
  });

  const body = lines.join("\n").replaceAll(/^export function /gmu, "function ");

  if (/^\s*(?:import|export)\b/mu.test(body)) {
    throw new Error(`TypeBox generated an import or export this plugin can't place for ${path}.`);
  }

  const externals = generated.External.variables.map((value) => {
    if (!(value instanceof RegExp)) {
      throw new Error(`TypeBox generated an external value this plugin can't write for ${path}.`);
    }

    return value.toString();
  });

  return `${body}\nSetExternal({ variables: [${externals.join(", ")}] });`;
}
