import type { ServerSpec } from "../spec.ts";
import schemas from "./vscode-json-schemas.json" with { type: "json" };
import { langserversExtracted } from "./vscode-langservers-extracted.ts";

export const SCHEMA_STORE = "https://www.schemastore.org/";

export const VSCODE_JSON_LANGUAGE_SERVER: ServerSpec = {
  name: "vscode-json-language-server",
  languages: ["json"],
  rootMarkers: ["package.json"],
  program: "vscode-json-language-server",
  probe: null,
  arguments: ["--stdio"],
  install: langserversExtracted("vscode-json-language-server"),
  installHint: "Install the JSON language server: npm install -g vscode-langservers-extracted",
  initializationOptions: {
    handledSchemaProtocols: ["https", "http", "file"],
    provideFormatter: true,
    customCapabilities: { rangeFormatting: { editLimit: 10_000 } },
  },
  settings: {
    http: { proxy: "", proxyStrictSSL: true },
    json: {
      schemas: Object.entries(schemas).map(([file, fileMatch]) => ({
        fileMatch,
        url: `${SCHEMA_STORE}${file}`,
      })),
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
