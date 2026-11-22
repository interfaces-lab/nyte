import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Asset, ServerSpec } from "../spec.ts";

const VERSION = "3.19.2";

const CACHE = join(tmpdir(), "nyte-lua-language-server");

const LOG_PATH = join(CACHE, "log");

const META_PATH = join(CACHE, "meta");

function asset(target: string, sha256: string, bytes: number): Asset {
  const windows = target.startsWith("win32-");

  return {
    url: `https://github.com/LuaLS/lua-language-server/releases/download/${VERSION}/lua-language-server-${VERSION}-${target}.${windows ? "zip" : "tar.gz"}`,
    sha256,
    format: windows ? "zip" : "tar.gz",
    bin: windows ? "bin/lua-language-server.exe" : "bin/lua-language-server",
    bytes,
  };
}

export const LUA_LANGUAGE_SERVER: ServerSpec = {
  name: "lua-language-server",
  languages: ["lua"],
  rootMarkers: [".luarc.json", ".luarc.jsonc", ".luacheckrc", ".stylua.toml", "stylua.toml"],
  program: "lua-language-server",
  probe: [`--logpath=${LOG_PATH}`, "--version"],
  arguments: ["--locale=en-us", `--logpath=${LOG_PATH}`, `--metapath=${META_PATH}`],
  install: {
    kind: "release",
    package: "lua-language-server",
    version: VERSION,
    assets: {
      "darwin-arm64": asset(
        "darwin-arm64",
        "79149584320a23bd5fcd5bc31f47a1975acd8a4560a0e89036bb1016fa61687f",
        3_286_148,
      ),
      "darwin-x64": asset(
        "darwin-x64",
        "6f2174ece5ec63bcd9d5b22b2c902445c1cd9045fafe48c62602448ebf4c09cc",
        2_337_043,
      ),
      "linux-arm64": asset(
        "linux-arm64",
        "17b8e401a874440adeb649e5024c364f2bb9d15156c74a40e56d1ae9a1b2e4f2",
        2_633_728,
      ),
      "linux-x64": asset(
        "linux-x64",
        "93ad326b10f6c00911dd8c450fa098332dbd8f9f45d1052f5636a2d54479b947",
        3_696_210,
      ),
      "win32-x64": asset(
        "win32-x64",
        "4a3dc851b3b31e7b75a23f645d1ba4a2137579a55f5fa4edbb17a3e2a6254044",
        4_455_290,
      ),
    },
  },
  installsOnRequest: true,
  installHint:
    "Install lua-language-server: brew install lua-language-server, or download a release from https://github.com/LuaLS/lua-language-server/releases",
  initializationOptions: {
    trustByClient: true,
    useSemanticByRange: true,
  },
  settings: {
    Lua: {
      runtime: {
        version: "Lua 5.4",
        path: ["?.lua", "?/init.lua"],
        pathStrict: false,
        fileEncoding: "utf8",
      },
      diagnostics: {
        enable: true,
        workspaceEvent: "OnSave",
        workspaceDelay: 3000,
        workspaceRate: 100,
        libraryFiles: "Opened",
        ignoredFiles: "Opened",
      },
      workspace: {
        ignoreDir: [".vscode"],
        ignoreSubmodules: true,
        useGitIgnore: true,
        maxPreload: 5000,
        preloadFileSize: 500,
        checkThirdParty: "Disable",
      },
      completion: {
        enable: true,
        callSnippet: "Disable",
        keywordSnippet: "Replace",
        displayContext: 0,
        workspaceWord: true,
        showWord: "Fallback",
        autoRequire: true,
        maxSuggestCount: 100,
        showParams: true,
        requireFunction: "require",
        requireSeparator: ".",
        postfix: "@",
      },
      signatureHelp: { enable: true },
      hover: {
        enable: true,
        viewString: true,
        viewStringMax: 1000,
        viewNumber: true,
        previewFields: 10,
        enumsLimit: 5,
        expandAlias: true,
      },
      semantic: {
        enable: true,
        variable: true,
        annotation: true,
        keyword: false,
      },
      hint: {
        enable: true,
        paramType: true,
        setType: false,
        paramName: "All",
        await: true,
        awaitPropagate: false,
        arrayIndex: "Auto",
        semicolon: "SameLine",
      },
      format: { enable: true, defaultConfig: {} },
      codeLens: { enable: false },
      window: { statusBar: false, progressBar: true },
    },
    files: {
      associations: {},
      exclude: {
        "**/.DS_Store": true,
        "**/.git": true,
        "**/.hg": true,
        "**/.svn": true,
        "**/CVS": true,
        "**/Thumbs.db": true,
      },
    },
    editor: {
      semanticHighlighting: { enabled: true },
      acceptSuggestionOnEnter: "on",
    },
  },
};
