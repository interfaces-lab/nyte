import type { ServerSpec } from "../spec.ts";
import { langserversExtracted } from "./vscode-langservers-extracted.ts";

export const CSS_SETTINGS = {
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
  program: "vscode-css-language-server",
  probe: null,
  arguments: ["--stdio"],
  install: langserversExtracted("vscode-css-language-server"),
  installHint: "Install the CSS language server: npm install -g vscode-langservers-extracted",
  initializationOptions: {
    handledSchemas: ["file"],
    provideFormatter: true,
    customCapabilities: { rangeFormatting: { editLimit: 10_000 } },
  },
  settings: {
    css: { customData: [], ...CSS_SETTINGS },
    scss: CSS_SETTINGS,
    less: CSS_SETTINGS,
  },
};
