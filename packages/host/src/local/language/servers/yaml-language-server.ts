import type { ServerSpec } from "../spec.ts";
import packages from "./yaml-language-server.lock.json" with { type: "json" };

const YAML_SETTINGS = {
  yamlVersion: "1.2",
  schemas: {},
  disableSchemaDetection: [],
  kubernetesCRDStore: {
    enable: true,
    url: "https://raw.githubusercontent.com/datreeio/CRDs-catalog/main",
  },
  format: {
    enable: true,
    singleQuote: false,
    bracketSpacing: true,
    proseWrap: "preserve",
    printWidth: 80,
    trailingComma: true,
  },
  validate: true,
  hover: true,
  hoverAnchor: true,
  hoverSchemaSource: true,
  completion: true,
  customTags: [],
  schemaStore: {
    enable: true,
    url: "https://www.schemastore.org/api/json/catalog.json",
  },
  disableAdditionalProperties: false,
  disableDefaultProperties: false,
  maxItemsComputed: 5000,
  suggest: { parentSkeletonSelectedFirst: false },
  style: { flowMapping: "allow", flowSequence: "allow" },
  keyOrdering: false,
} as const;

export const YAML_LANGUAGE_SERVER: ServerSpec = {
  name: "yaml-language-server",
  languages: ["yaml"],
  rootMarkers: [".git"],
  requiresRootMarker: false,
  program: "yaml-language-server",
  probe: ["--version"],
  arguments: ["--stdio"],
  install: {
    kind: "npm",
    package: "yaml-language-server",
    version: "2.1.1-bf8ebb5.0",
    packages,
    entry: "node_modules/yaml-language-server/bin/yaml-language-server",
  },
  runtime: null,
  installHint: "Install the YAML language server: npm install -g yaml-language-server",
  initializationOptions: null,
  settings: {
    yaml: YAML_SETTINGS,
    http: { proxy: "", proxyStrictSSL: false },
    "[yaml]": { "editor.tabSize": 2 },
    editor: { tabSize: 2, detectIndentation: false },
  },
};
