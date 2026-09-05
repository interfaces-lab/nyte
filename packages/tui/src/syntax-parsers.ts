/**
 * Tree-sitter grammars beyond the four OpenTUI bundles (typescript,
 * javascript, markdown, zig), so a read, a diff, or a shell command in any
 * common language draws in color.
 *
 * Registration is cheap: the worker fetches a grammar and its queries the
 * first time that filetype is drawn and caches them under the OpenTUI data
 * path. A run with no network keeps working and stays plain.
 *
 * Based on opencode v2's parser table:
 * https://github.com/anomalyco/opencode/blob/v2/packages/tui/src/parsers-config.ts
 */
import { addDefaultParsers } from "@opentui/core";
import type { FiletypeParserOptions } from "@opentui/core";

const NVIM_QUERIES =
  "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries";

/** nvim-treesitter names its query directory after the grammar, not the filetype. */
function nvim(grammar: string): string[] {
  return [`${NVIM_QUERIES}/${grammar}/highlights.scm`];
}

const PARSERS: readonly FiletypeParserOptions[] = [
  {
    filetype: "bash",
    aliases: ["sh", "shell", "zsh"],
    wasm: "https://github.com/tree-sitter/tree-sitter-bash/releases/download/v0.25.0/tree-sitter-bash.wasm",
    queries: { highlights: nvim("bash") },
  },
  {
    filetype: "python",
    wasm: "https://github.com/tree-sitter/tree-sitter-python/releases/download/v0.23.6/tree-sitter-python.wasm",
    // nvim-treesitter's query uses `except` nodes this parser rejects.
    queries: {
      highlights: [
        "https://github.com/tree-sitter/tree-sitter-python/raw/refs/heads/master/queries/highlights.scm",
      ],
    },
  },
  {
    filetype: "go",
    wasm: "https://github.com/tree-sitter/tree-sitter-go/releases/download/v0.25.0/tree-sitter-go.wasm",
    queries: { highlights: nvim("go") },
  },
  {
    filetype: "rust",
    wasm: "https://github.com/tree-sitter/tree-sitter-rust/releases/download/v0.24.0/tree-sitter-rust.wasm",
    queries: { highlights: nvim("rust") },
  },
  {
    filetype: "c",
    wasm: "https://github.com/tree-sitter/tree-sitter-c/releases/download/v0.24.1/tree-sitter-c.wasm",
    queries: { highlights: nvim("c") },
  },
  {
    filetype: "cpp",
    wasm: "https://github.com/tree-sitter/tree-sitter-cpp/releases/download/v0.23.4/tree-sitter-cpp.wasm",
    queries: { highlights: nvim("cpp") },
  },
  {
    filetype: "csharp",
    wasm: "https://github.com/tree-sitter/tree-sitter-c-sharp/releases/download/v0.23.1/tree-sitter-c_sharp.wasm",
    queries: { highlights: nvim("c_sharp") },
  },
  {
    filetype: "java",
    wasm: "https://github.com/tree-sitter/tree-sitter-java/releases/download/v0.23.5/tree-sitter-java.wasm",
    queries: { highlights: nvim("java") },
  },
  {
    filetype: "kotlin",
    wasm: "https://github.com/fwcd/tree-sitter-kotlin/releases/download/0.3.8/tree-sitter-kotlin.wasm",
    queries: {
      highlights: [
        "https://raw.githubusercontent.com/fwcd/tree-sitter-kotlin/0.3.8/queries/highlights.scm",
      ],
    },
  },
  {
    filetype: "swift",
    wasm: "https://github.com/alex-pinkus/tree-sitter-swift/releases/download/0.7.1/tree-sitter-swift.wasm",
    // nvim-treesitter's query needs `#lua-match?`, which web-tree-sitter lacks.
    queries: {
      highlights: [
        "https://raw.githubusercontent.com/alex-pinkus/tree-sitter-swift/main/queries/highlights.scm",
      ],
    },
  },
  {
    filetype: "ruby",
    wasm: "https://github.com/tree-sitter/tree-sitter-ruby/releases/download/v0.23.1/tree-sitter-ruby.wasm",
    queries: { highlights: nvim("ruby") },
  },
  {
    filetype: "php",
    wasm: "https://github.com/tree-sitter/tree-sitter-php/releases/download/v0.24.2/tree-sitter-php.wasm",
    queries: {
      highlights: [
        "https://github.com/tree-sitter/tree-sitter-php/raw/refs/heads/master/queries/highlights.scm",
      ],
    },
  },
  {
    filetype: "scala",
    wasm: "https://github.com/tree-sitter/tree-sitter-scala/releases/download/v0.24.0/tree-sitter-scala.wasm",
    queries: { highlights: nvim("scala") },
  },
  {
    filetype: "elixir",
    wasm: "https://github.com/elixir-lang/tree-sitter-elixir/releases/download/v0.3.5/tree-sitter-elixir.wasm",
    queries: { highlights: nvim("elixir") },
  },
  {
    filetype: "haskell",
    wasm: "https://github.com/tree-sitter/tree-sitter-haskell/releases/download/v0.23.1/tree-sitter-haskell.wasm",
    queries: { highlights: nvim("haskell") },
  },
  {
    filetype: "ocaml",
    wasm: "https://github.com/tree-sitter/tree-sitter-ocaml/releases/download/v0.24.2/tree-sitter-ocaml.wasm",
    queries: { highlights: nvim("ocaml") },
  },
  {
    filetype: "clojure",
    wasm: "https://github.com/anomalyco/tree-sitter-clojure/releases/download/v0.0.1/tree-sitter-clojure.wasm",
    queries: { highlights: nvim("clojure") },
  },
  {
    filetype: "lua",
    wasm: "https://github.com/tree-sitter-grammars/tree-sitter-lua/releases/download/v0.5.0/tree-sitter-lua.wasm",
    queries: {
      highlights: [
        "https://raw.githubusercontent.com/tree-sitter-grammars/tree-sitter-lua/v0.5.0/queries/highlights.scm",
      ],
    },
  },
  {
    filetype: "julia",
    wasm: "https://github.com/tree-sitter/tree-sitter-julia/releases/download/v0.23.1/tree-sitter-julia.wasm",
    queries: { highlights: nvim("julia") },
  },
  {
    filetype: "r",
    wasm: "https://github.com/r-lib/tree-sitter-r/releases/download/v1.2.0/tree-sitter-r.wasm",
    queries: { highlights: nvim("r") },
  },
  {
    filetype: "fsharp",
    wasm: "https://github.com/ionide/tree-sitter-fsharp/releases/download/0.3.0/tree-sitter-fsharp.wasm",
    queries: { highlights: nvim("fsharp") },
  },
  {
    filetype: "html",
    wasm: "https://github.com/tree-sitter/tree-sitter-html/releases/download/v0.23.2/tree-sitter-html.wasm",
    queries: {
      highlights: [
        "https://github.com/tree-sitter/tree-sitter-html/raw/refs/heads/master/queries/highlights.scm",
      ],
    },
  },
  {
    filetype: "css",
    wasm: "https://github.com/tree-sitter/tree-sitter-css/releases/download/v0.25.0/tree-sitter-css.wasm",
    queries: { highlights: nvim("css") },
  },
  {
    filetype: "vue",
    wasm: "https://github.com/anomalyco/tree-sitter-vue/releases/download/v0.1.2/tree-sitter-vue.wasm",
    queries: {
      highlights: [
        "https://raw.githubusercontent.com/anomalyco/tree-sitter-vue/v0.1.2/queries/html_tags/highlights.scm",
        "https://raw.githubusercontent.com/anomalyco/tree-sitter-vue/v0.1.2/queries/vue/highlights.scm",
      ],
    },
  },
  {
    filetype: "json",
    wasm: "https://github.com/tree-sitter/tree-sitter-json/releases/download/v0.24.8/tree-sitter-json.wasm",
    queries: { highlights: nvim("json") },
  },
  {
    filetype: "yaml",
    wasm: "https://github.com/tree-sitter-grammars/tree-sitter-yaml/releases/download/v0.7.2/tree-sitter-yaml.wasm",
    queries: { highlights: nvim("yaml") },
  },
  {
    filetype: "toml",
    wasm: "https://github.com/tree-sitter-grammars/tree-sitter-toml/releases/download/v0.7.0/tree-sitter-toml.wasm",
    queries: { highlights: nvim("toml") },
  },
  {
    filetype: "xml",
    wasm: "https://github.com/tree-sitter-grammars/tree-sitter-xml/releases/download/v0.7.0/tree-sitter-xml.wasm",
    queries: { highlights: nvim("xml") },
  },
  {
    filetype: "hcl",
    wasm: "https://github.com/tree-sitter-grammars/tree-sitter-hcl/releases/download/v1.2.0/tree-sitter-hcl.wasm",
    queries: { highlights: nvim("hcl") },
  },
  {
    filetype: "nix",
    // The official grammar publishes no wasm: https://github.com/nix-community/tree-sitter-nix/issues/66
    wasm: "https://github.com/ast-grep/ast-grep.github.io/raw/40b84530640aa83a0d34a20a2b0623d7b8e5ea97/website/public/parsers/tree-sitter-nix.wasm",
    queries: { highlights: nvim("nix") },
  },
  {
    filetype: "make",
    aliases: ["makefile"],
    wasm: "https://github.com/tree-sitter-grammars/tree-sitter-make/releases/download/v1.1.1/tree-sitter-make.wasm",
    queries: { highlights: nvim("make") },
  },
  {
    filetype: "vim",
    wasm: "https://github.com/tree-sitter-grammars/tree-sitter-vim/releases/download/v0.8.1/tree-sitter-vim.wasm",
    queries: { highlights: nvim("vim") },
  },
  {
    filetype: "diff",
    aliases: ["udiff", "patch"],
    wasm: "https://github.com/tree-sitter-grammars/tree-sitter-diff/releases/download/v0.1.0/tree-sitter-diff.wasm",
    queries: {
      highlights: [
        "https://raw.githubusercontent.com/tree-sitter-grammars/tree-sitter-diff/2520c3f934b3179bb540d23e0ef45f75304b5fed/queries/highlights.scm",
      ],
    },
  },
];

let registered = false;

/** Teach OpenTUI the extra grammars. Safe to call more than once. */
export function registerSyntaxParsers(): void {
  if (registered) return;
  registered = true;
  addDefaultParsers([...PARSERS]);
}
