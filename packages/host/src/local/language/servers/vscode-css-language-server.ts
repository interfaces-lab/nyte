import type { ServerSpec } from "../spec.ts";
import packages from "./vscode-langservers-extracted.lock.json" with { type: "json" };

const STYLE_DEFAULTS = {
  validate: true,
  completion: {
    triggerPropertyValueCompletion: true,
    completePropertyWithSemicolon: true,
  },
  hover: {
    documentation: true,
    references: true,
  },
  lint: {
    compatibleVendorPrefixes: "ignore",
    vendorPrefix: "warning",
    duplicateProperties: "ignore",
    emptyRules: "warning",
    importStatement: "ignore",
    boxModel: "ignore",
    universalSelector: "ignore",
    zeroUnits: "ignore",
    fontFaceProperties: "warning",
    hexColorLength: "error",
    argumentsInColorFunction: "error",
    unknownProperties: "warning",
    validProperties: [],
    ieHack: "ignore",
    unknownVendorSpecificProperties: "ignore",
    propertyIgnoredDueToDisplay: "warning",
    important: "ignore",
    float: "ignore",
    idSelector: "ignore",
    unknownAtRules: "warning",
  },
  format: {
    enable: true,
    newlineBetweenSelectors: true,
    newlineBetweenRules: true,
    spaceAroundSelectorSeparator: false,
    braceStyle: "collapse",
    preserveNewLines: true,
    maxPreserveNewLines: null,
  },
} as const;

export const VSCODE_CSS_LANGUAGE_SERVER: ServerSpec = {
  name: "vscode-css-language-server",
  languages: ["css"],
  rootMarkers: ["package.json"],
  requiresRootMarker: false,
  program: "vscode-css-language-server",
  probe: null,
  arguments: ["--stdio"],
  install: {
    kind: "npm",
    package: "vscode-langservers-extracted",
    version: "4.10.0",
    packages,
    entry: "node_modules/vscode-langservers-extracted/bin/vscode-css-language-server",
  },
  runtime: null,
  installHint: "Install the CSS language server: npm install -g vscode-langservers-extracted",
  initializationOptions: {
    handledSchemas: ["file"],
    provideFormatter: true,
    customCapabilities: { rangeFormatting: { editLimit: 10_000 } },
  },
  settings: {
    css: { customData: [], ...STYLE_DEFAULTS },
    scss: STYLE_DEFAULTS,
    less: STYLE_DEFAULTS,
  },
};
