import { Value } from "typebox/value";
import { Language, Parser, Query } from "web-tree-sitter";
import { fileStructureAssets, runtimeUrl } from "./file-structure-assets.ts";
import { parseFileStructure } from "./file-structure-parse.ts";
import { structureRequest } from "./file-structure-protocol.ts";
import type { StructureRequest, StructureResponse } from "./file-structure-protocol.ts";
import type { StructureLanguage } from "./file-structure-profiles.ts";

let pending: StructureRequest | undefined;

let running = false;

let initialized: Promise<void> | undefined;

let context:
  | {
      readonly language: StructureLanguage;
      readonly parser: Parser;
      readonly folds: Query;
      readonly symbols: Query | undefined;
    }
  | undefined;

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (!Value.Check(structureRequest, event.data))
    throw new Error("Invalid file structure request.");
  pending = event.data;

  if (!running) void parsePending();
});

async function parsePending(): Promise<void> {
  running = true;

  while (pending !== undefined) {
    const request = pending;
    pending = undefined;

    try {
      initialized ??= fetchBytes(runtimeUrl).then((bytes) => Parser.init({ wasmBinary: bytes }));
      await initialized;
      const current = await loadLanguage(request.language);

      if (pending !== undefined) continue;
      const tree = current.parser.parse(request.contents);

      if (tree === null) throw new Error("File structure parsing did not finish.");

      try {
        const result = parseFileStructure({
          contents: request.contents,
          tree,
          folds: current.folds,
          symbols: current.symbols,
        });

        const response = {
          ...request,
          folds: result.folds.slice(),
          symbols: result.symbols.slice(),
          kind: "ready",
        } satisfies StructureResponse;

        self.postMessage(response);
      } finally {
        tree.delete();
      }
    } catch (error) {
      if (pending !== undefined) continue;
      self.postMessage({
        ...request,
        kind: "error",
        error: error instanceof Error ? error.message : String(error),
      } satisfies StructureResponse);
    }
  }

  running = false;
}

async function loadLanguage(language: StructureLanguage) {
  if (context?.language === language) return context;
  context?.symbols?.delete();
  context?.folds.delete();
  context?.parser.delete();
  context = undefined;
  const assets = fileStructureAssets[language];

  const inputs = await Promise.all([
    fetchBytes(assets.wasm),
    fetchText(assets.folds),
    assets.symbols === undefined ? undefined : fetchText(assets.symbols),
  ]);

  const grammar = await Language.load(inputs[0]);
  const parser = new Parser();
  let folds: Query | undefined;

  try {
    parser.setLanguage(grammar);
    folds = new Query(grammar, inputs[1]);
    const symbols = inputs[2] === undefined ? undefined : new Query(grammar, inputs[2]);
    context = { language, parser, folds, symbols };

    return context;
  } catch (error) {
    folds?.delete();
    parser.delete();
    throw error;
  }
}

async function fetchBytes(url: string): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(url);

  if (!response.ok) throw new Error(`Could not load file structure asset: ${response.status}`);

  return new Uint8Array(await response.arrayBuffer());
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);

  if (!response.ok) throw new Error(`Could not load file structure query: ${response.status}`);

  return response.text();
}
