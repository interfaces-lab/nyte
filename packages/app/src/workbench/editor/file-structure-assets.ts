import type { StructureLanguage } from "./file-structure-profiles.ts";
import runtimeUrl from "web-tree-sitter/tree-sitter.wasm?url&no-inline";
import javascriptWasm from "./grammars/javascript.wasm?url&no-inline";
import typescriptWasm from "./grammars/typescript.wasm?url&no-inline";
import tsxWasm from "./grammars/tsx.wasm?url&no-inline";
import pythonWasm from "./grammars/python.wasm?url&no-inline";
import goWasm from "./grammars/go.wasm?url&no-inline";
import rustWasm from "./grammars/rust.wasm?url&no-inline";
import jsonWasm from "./grammars/json.wasm?url&no-inline";
import cssWasm from "./grammars/css.wasm?url&no-inline";
import htmlWasm from "./grammars/html.wasm?url&no-inline";
import markdownWasm from "./grammars/markdown.wasm?url&no-inline";
import yamlWasm from "./grammars/yaml.wasm?url&no-inline";
import bashWasm from "./grammars/bash.wasm?url&no-inline";
import javascriptQuery from "./grammars/javascript.scm?url&no-inline";
import javascriptSymbolsQuery from "./grammars/javascript-symbols.scm?url&no-inline";
import typescriptQuery from "./grammars/typescript.scm?url&no-inline";
import typescriptSymbolsQuery from "./grammars/typescript-symbols.scm?url&no-inline";
import tsxQuery from "./grammars/tsx.scm?url&no-inline";
import pythonQuery from "./grammars/python.scm?url&no-inline";
import pythonSymbolsQuery from "./grammars/python-symbols.scm?url&no-inline";
import goQuery from "./grammars/go.scm?url&no-inline";
import goSymbolsQuery from "./grammars/go-symbols.scm?url&no-inline";
import rustQuery from "./grammars/rust.scm?url&no-inline";
import rustSymbolsQuery from "./grammars/rust-symbols.scm?url&no-inline";
import jsonQuery from "./grammars/json.scm?url&no-inline";
import cssQuery from "./grammars/css.scm?url&no-inline";
import htmlQuery from "./grammars/html.scm?url&no-inline";
import markdownQuery from "./grammars/markdown.scm?url&no-inline";
import markdownSymbolsQuery from "./grammars/markdown-symbols.scm?url&no-inline";
import yamlQuery from "./grammars/yaml.scm?url&no-inline";
import bashQuery from "./grammars/bash.scm?url&no-inline";
import bashSymbolsQuery from "./grammars/bash-symbols.scm?url&no-inline";

export { runtimeUrl };

export const fileStructureAssets = {
  javascript: { wasm: javascriptWasm, folds: javascriptQuery, symbols: javascriptSymbolsQuery },
  typescript: { wasm: typescriptWasm, folds: typescriptQuery, symbols: typescriptSymbolsQuery },
  tsx: { wasm: tsxWasm, folds: tsxQuery, symbols: typescriptSymbolsQuery },
  python: { wasm: pythonWasm, folds: pythonQuery, symbols: pythonSymbolsQuery },
  go: { wasm: goWasm, folds: goQuery, symbols: goSymbolsQuery },
  rust: { wasm: rustWasm, folds: rustQuery, symbols: rustSymbolsQuery },
  json: { wasm: jsonWasm, folds: jsonQuery, symbols: undefined },
  css: { wasm: cssWasm, folds: cssQuery, symbols: undefined },
  html: { wasm: htmlWasm, folds: htmlQuery, symbols: undefined },
  markdown: { wasm: markdownWasm, folds: markdownQuery, symbols: markdownSymbolsQuery },
  yaml: { wasm: yamlWasm, folds: yamlQuery, symbols: undefined },
  bash: { wasm: bashWasm, folds: bashQuery, symbols: bashSymbolsQuery },
} satisfies Record<
  StructureLanguage,
  { readonly wasm: string; readonly folds: string; readonly symbols: string | undefined }
>;
