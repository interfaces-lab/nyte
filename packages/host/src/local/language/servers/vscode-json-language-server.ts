import type { ServerSpec } from "../spec.ts";
import schemas from "./vscode-json-schemas.json" with { type: "json" };
import packages from "./vscode-langservers-extracted.lock.json" with { type: "json" };

export const VSCODE_JSON_LANGUAGE_SERVER: ServerSpec = {
  name: "vscode-json-language-server",
  languages: ["json"],
  rootMarkers: ["package.json"],
  requiresRootMarker: false,
  program: "vscode-json-language-server",
  probe: null,
  arguments: ["--stdio"],
  install: {
    kind: "npm",
    package: "vscode-langservers-extracted",
    version: "4.10.0",
    packages,
    entry: "node_modules/vscode-langservers-extracted/bin/vscode-json-language-server",
  },
  runtime: null,
  installHint: "Install the JSON language server: npm install -g vscode-langservers-extracted",
  initializationOptions: {
    handledSchemaProtocols: ["https", "http", "file"],
    provideFormatter: true,
    customCapabilities: { rangeFormatting: { editLimit: 10_000 } },
  },
  settings: {
    http: { proxy: "", proxyStrictSSL: true },
    json: {
      schemas,
      validate: { enable: true },
      format: { enable: true },
      keepLines: { enable: false },
      resultLimit: 5000,
      jsonFoldingLimit: 5000,
      jsoncFoldingLimit: 5000,
      jsonColorDecoratorLimit: 5000,
      jsoncColorDecoratorLimit: 5000,
    },
  },
};
