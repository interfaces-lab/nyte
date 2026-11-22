import { basename } from "node:path";
import type { LanguageApi, LanguagePosition } from "@nyte-ai/core";
import type { Json, LanguageFeature, LanguageLocation, TextRange } from "@nyte-ai/schema";
import { findProvider } from "./capabilities.ts";
import {
  nestRanges,
  readFoldingRanges,
  readHighlights,
  readSelectionRanges,
  readSemanticTokens,
  readWorkspaceSymbols,
} from "./lsp-structure.ts";
import {
  comparePositions,
  findWord,
  readHover,
  readInlayHints,
  readLocations,
  readPrepareRename,
  readSignatureHelp,
  readSymbols,
  readTextEdits,
  readWorkspaceEdit,
  toLspPosition,
  toLspRange,
} from "./lsp.ts";
import { LspError } from "./rpc.ts";
import { ask, askEvery, askFirst, findProviders } from "./route.ts";
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
  | "implementation"
  | "declaration"
  | "references"
  | "documentHighlights"
  | "symbols"
  | "workspaceSymbols"
  | "prepareRename"
  | "rename"
  | "format"
  | "signatureHelp"
  | "inlayHints"
  | "foldingRanges"
  | "selectionRanges"
  | "semanticTokens"
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
    implementation: (input) => locate("implementation", "textDocument/implementation", input),
    declaration: (input) => locate("declaration", "textDocument/declaration", input),
    references: (input) =>
      locate("references", "textDocument/references", input, (asked) => ({
        ...at(input)(asked),
        context: { includeDeclaration: input.includeDeclaration },
      })),
    async documentHighlights(input) {
      return (
        (await askFirst(
          servers,
          {
            path: input.path,
            feature: "documentHighlights",
            method: "textDocument/documentHighlight",
          },
          at(input),
          readHighlights,
        )) ?? []
      );
    },
    async symbols(input) {
      const blocks = await askEvery(
        servers,
        { path: input.path, feature: "symbols", method: "textDocument/documentSymbol" },
        inDocument,
        readSymbols,
      );

      return blocks.flat();
    },
    async workspaceSymbols(input) {
      const found = await Promise.all(
        servers.running().map(async (target) => {
          if (findProvider(target.run, "workspaceSymbols", null) === null) return [];
          const asking = await ask(servers, target, "workspace/symbol", { query: input.query });

          return asking instanceof LspError
            ? []
            : readWorkspaceSymbols(asking.answer, servers.place);
        }),
      );

      return found.flat();
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
      const formatters = await findProviders(servers, input.path, "format");
      const failures: string[] = [];

      for (const asked of formatters) {
        const asking = await ask(servers, asked.target, "textDocument/formatting", {
          ...inDocument(asked),
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
          reason: `No language server formats ${basename(input.path)}.`,
        };
      }

      return failures.length === formatters.length
        ? { kind: "failed", reason: failures[0] ?? "" }
        : { kind: "edits", edits: [] };
    },
    signatureHelp: (input) =>
      askFirst(
        servers,
        { path: input.path, feature: "signatureHelp", method: "textDocument/signatureHelp" },
        at(input),
        readSignatureHelp,
      ),
    async inlayHints(input) {
      const hints = await askEvery(
        servers,
        { path: input.path, feature: "inlayHints", method: "textDocument/inlayHint" },
        (asked) => ({ ...inDocument(asked), range: toLspRange(input.range) }),
        readInlayHints,
      );

      return hints
        .flat()
        .toSorted((left, right) => comparePositions(left.position, right.position));
    },
    async foldingRanges(input) {
      const ranges = await askEvery(
        servers,
        { path: input.path, feature: "foldingRanges", method: "textDocument/foldingRange" },
        inDocument,
        readFoldingRanges,
      );

      return ranges
        .flat()
        .toSorted((left, right) => left.startLine - right.startLine || right.endLine - left.endLine)
        .filter((range, index, sorted) => sorted[index - 1]?.startLine !== range.startLine);
    },
    async selectionRanges(input) {
      const answers = await askEvery(
        servers,
        { path: input.path, feature: "selectionRanges", method: "textDocument/selectionRange" },
        (asked) => ({ ...inDocument(asked), positions: input.positions.map(toLspPosition) }),
        readSelectionRanges,
      );

      return input.positions.map((_, index) =>
        nestRanges(answers.flatMap((answer): readonly TextRange[] => answer[index] ?? [])),
      );
    },
    async semanticTokens(input) {
      for (const asked of await findProviders(servers, input.path, "semanticTokens")) {
        const ranged = (asked.provider.range ?? false) !== false;
        const whole = (asked.provider.full ?? false) !== false;
        const range = input.range ?? (whole ? undefined : wholeDocument(asked.document.text));

        if (range !== undefined && !ranged && !whole) continue;

        const asking =
          range !== undefined && ranged
            ? await ask(servers, asked.target, "textDocument/semanticTokens/range", {
                ...inDocument(asked),
                range: toLspRange(range),
              })
            : await ask(
                servers,
                asked.target,
                "textDocument/semanticTokens/full",
                inDocument(asked),
              );

        const tokens =
          asking instanceof LspError ? null : readSemanticTokens(asking.answer, asked.provider);

        if (tokens !== null) return tokens;
      }

      return null;
    },
  };
}

function wholeDocument(text: string): TextRange {
  const lines = text.split("\n");

  return {
    start: { line: 0, utf16Column: 0 },
    end: { line: lines.length - 1, utf16Column: lines.at(-1)?.length ?? 0 },
  };
}
