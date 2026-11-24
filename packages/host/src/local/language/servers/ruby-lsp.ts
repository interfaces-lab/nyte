import { delimiter } from "node:path";
import { INSTALL_FOLDER } from "../spec.ts";
import type { ServerSpec } from "../spec.ts";

const VERSION = "0.26.11";

const ENABLED_FEATURES = [
  "codeActions",
  "diagnostics",
  "documentHighlights",
  "documentLink",
  "documentSymbols",
  "foldingRanges",
  "formatting",
  "hover",
  "inlayHint",
  "onTypeFormatting",
  "selectionRanges",
  "semanticHighlighting",
  "completion",
  "codeLens",
  "definition",
  "workspaceSymbol",
  "signatureHelp",
  "typeHierarchy",
] as const;

export const RUBY_LSP: ServerSpec = {
  name: "ruby-lsp",
  languages: ["ruby"],
  rootMarkers: ["Gemfile", "Gemfile.lock", "gems.rb", "gems.locked", ".ruby-version"],
  program: "ruby-lsp",
  install: {
    kind: "toolchain",
    package: "ruby-lsp",
    version: VERSION,
    program: "gem",
    arguments: [
      "install",
      "ruby-lsp",
      "-v",
      VERSION,
      "--install-dir",
      INSTALL_FOLDER,
      "--bindir",
      `${INSTALL_FOLDER}/bin`,
      "--no-document",
      "--env-shebang",
    ],
    env: {
      GEM_HOME: INSTALL_FOLDER,
      GEM_PATH: `${INSTALL_FOLDER}${delimiter}`,
    },
    bin: "bin/ruby-lsp",
  },
  installsOnRequest: true,
  runtime: {
    program: "ruby",
    probe: ["--version"],
    installHint: "Install Ruby 3.0 or newer: https://www.ruby-lang.org/en/downloads/",
  },
  installHint: "Install Ruby LSP: gem install ruby-lsp",
  initializationOptions: {
    enabledFeatures: ENABLED_FEATURES,
    featuresConfiguration: {
      inlayHint: {
        enableAll: false,
        implicitRescue: false,
        implicitHashValue: false,
      },
      codeLens: {
        enableAll: false,
        enableTestCodeLens: true,
      },
    },
    formatter: "auto",
    linters: null,
    indexing: {},
    addonSettings: {},
    enabledFeatureFlags: {
      tapiocaAddon: true,
      fullTestDiscovery: true,
      launcher: false,
      betaServer: false,
    },
  },
};
