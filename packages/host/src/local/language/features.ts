import { basename } from "node:path";
import type { LanguageApi, LanguagePosition } from "@nyte-ai/core";
import type { Json, LanguageFeature, LanguageLocation } from "@nyte-ai/schema";
import {
  findWord,
  readHover,
  readLocations,
  readPrepareRename,
  readSymbols,
  readTextEdits,
  readWorkspaceEdit,
  toLspPosition,
  toLspRange,
} from "./lsp.ts";
import { LspError } from "./rpc.ts";
import { ask, askEvery, findProviders } from "./route.ts";
import type { Asked } from "./route.ts";
import type { Servers } from "./state.ts";

const HOVER_SEPARATOR = "\n\n---\n\n";

export function languageFeatures(
  servers: Servers,
): Pick<
  LanguageApi,
  | "hover"
  | "definition"
  | "typeDefinition"
  | "references"
  | "symbols"
  | "prepareRename"
  | "rename"
  | "format"
> {
  const inDocument = (asked: Asked) => ({ textDocument: { uri: asked.uri } });

  const at = (input: LanguagePosition) => (asked: Asked) => ({
    ...inDocument(asked),
    position: toLspPosition(input.position),
  });

  const locate = async (
    feature: LanguageFeature,
    method: string,
    input: LanguagePosition,
    params: (asked: Asked) => Json = at(input),
  ): Promise<readonly LanguageLocation[]> => {
    const found = await askEvery(servers, { path: input.path, feature, method }, params, (answer) =>
      readLocations(answer, servers.place),
    );

    return [
      ...new Map(
        found.flat().map((location) => [JSON.stringify(location), location] as const),
      ).values(),
    ];
  };

  return {
    async hover(input) {
      const parts = (
        await askEvery(
          servers,
          { path: input.path, feature: "hover", method: "textDocument/hover" },
          at(input),
          readHover,
        )
      ).filter((part) => part !== null);

      return parts.length === 0
        ? null
        : {
            markdown: parts.map((part) => part.markdown).join(HOVER_SEPARATOR),
            range: parts.find((part) => part.range !== null)?.range ?? null,
          };
    },
    definition: (input) => locate("definition", "textDocument/definition", input),
    typeDefinition: (input) => locate("typeDefinition", "textDocument/typeDefinition", input),
    references: (input) =>
      locate("references", "textDocument/references", input, (asked) => ({
        ...at(input)(asked),
        context: { includeDeclaration: input.includeDeclaration },
      })),
    async symbols(input) {
      const blocks = await askEvery(
        servers,
        { path: input.path, feature: "symbols", method: "textDocument/documentSymbol" },
        inDocument,
        readSymbols,
      );

      return blocks.flat();
    },
    async prepareRename(input) {
      for (const asked of await findProviders(servers, input.path, "rename")) {
        const text = asked.document.text;

        if (asked.provider.prepareProvider !== true) return findWord(text, input.position);

        const asking = await ask(
          servers,
          asked.target,
          "textDocument/prepareRename",
          at(input)(asked),
        );

        const found =
          asking instanceof LspError
            ? null
            : readPrepareRename(asking.answer, text, input.position);

        if (found !== null) return found;
      }

      return null;
    },
    async rename(input) {
      const reasons: string[] = [];

      for (const asked of await findProviders(servers, input.path, "rename")) {
        const asking = await ask(servers, asked.target, "textDocument/rename", {
          ...at(input)(asked),
          newName: input.name,
        });

        if (asking instanceof LspError) reasons.push(asking.message);
        else if (asking.answer === null) reasons.push("There is nothing to rename here.");
        else return readWorkspaceEdit(asking.answer, servers.place);
      }

      return {
        kind: "refused",
        reason:
          reasons.length === 0
            ? `No language server can rename in ${input.path}.`
            : [...new Set(reasons)].join("\n"),
      };
    },
    async format(input) {
      const range = input.range;

      const formatters = await findProviders(
        servers,
        input.path,
        range === undefined ? "format" : "formatRange",
      );

      const failures: string[] = [];

      for (const asked of formatters) {
        const asking =
          range === undefined
            ? await ask(servers, asked.target, "textDocument/formatting", {
                ...inDocument(asked),
                options: input.options,
              })
            : await ask(servers, asked.target, "textDocument/rangeFormatting", {
                ...inDocument(asked),
                range: toLspRange(range),
                options: input.options,
              });

        if (asking instanceof LspError) {
          failures.push(asking.message);
          continue;
        }

        const edits = readTextEdits(asking.answer);

        if (edits.length > 0) return { kind: "edits", edits };
      }

      if (formatters.length === 0) {
        return {
          kind: "unavailable",
          reason:
            range === undefined
              ? `No language server formats ${basename(input.path)}.`
              : `No language server formats a selection in ${basename(input.path)}.`,
        };
      }

      return failures.length === formatters.length
        ? { kind: "failed", reason: failures[0] ?? "" }
        : { kind: "edits", edits: [] };
    },
  };
}
