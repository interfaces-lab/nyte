import { pathToFileURL } from "node:url";
import type { Asset, ServerSpec } from "../spec.ts";

const VERSION = "1.43.0";

const URL =
  "https://download.eclipse.org/jdtls/milestones/1.43.0/jdt-language-server-1.43.0-202412191447.tar.gz";

const SHA256 = "e3a33ff888aaf1d998ec0b6e0f1ecb8eeac53eef88dde22204c3cd3379e5fb98";

function asset(windows: boolean): Asset {
  return {
    url: URL,
    sha256: SHA256,
    format: "tar.gz",
    bin: windows ? "bin/jdtls.bat" : "bin/jdtls",
    bytes: 48_216_630,
  };
}

const JAVA_SETTINGS = {
  autobuild: { enabled: true },
  maxConcurrentBuilds: 1,
  errors: { incompleteClasspath: { severity: "warning" } },
  configuration: {
    updateBuildConfiguration: "interactive",
    detectJdksAtStart: true,
    runtimes: [],
  },
  import: {
    exclusions: [
      "**/node_modules/**",
      "**/.metadata/**",
      "**/archetype-resources/**",
      "**/META-INF/maven/**",
    ],
    generatesMetadataFilesAtProjectRoot: false,
    maven: { enabled: true, offline: { enabled: false } },
    gradle: {
      enabled: true,
      wrapper: { enabled: true },
      offline: { enabled: false },
      annotationProcessing: { enabled: true },
    },
  },
  project: {
    resourceFilters: ["node_modules", String.raw`\.git`],
    referencedLibraries: ["lib/**/*.jar"],
    encoding: "ignore",
  },
  compile: {
    nullAnalysis: {
      mode: "interactive",
      nonnull: [
        "javax.annotation.Nonnull",
        "org.eclipse.jdt.annotation.NonNull",
        "org.springframework.lang.NonNull",
        "org.jspecify.annotations.NonNull",
      ],
      nullable: [
        "javax.annotation.Nullable",
        "org.eclipse.jdt.annotation.Nullable",
        "org.springframework.lang.Nullable",
        "org.jspecify.annotations.Nullable",
      ],
      nonnullbydefault: [
        "javax.annotation.ParametersAreNonnullByDefault",
        "org.eclipse.jdt.annotation.NonNullByDefault",
        "org.springframework.lang.NonNullApi",
        "org.jspecify.annotations.NullMarked",
      ],
    },
  },
  format: {
    enabled: true,
    comments: { enabled: true },
    onType: { enabled: true },
    insertSpaces: true,
    tabSize: 4,
  },
  completion: {
    enabled: true,
    postfix: { enabled: true },
    chain: { enabled: false },
    favoriteStaticMembers: [
      "org.junit.Assert.*",
      "org.junit.Assume.*",
      "org.junit.jupiter.api.Assertions.*",
      "org.junit.jupiter.api.Assumptions.*",
      "org.junit.jupiter.api.DynamicContainer.*",
      "org.junit.jupiter.api.DynamicTest.*",
      "org.mockito.Mockito.*",
      "org.mockito.ArgumentMatchers.*",
      "org.mockito.Answers.*",
    ],
    filteredTypes: [
      "java.awt.*",
      "com.sun.*",
      "sun.*",
      "jdk.*",
      "org.graalvm.*",
      "io.micrometer.shaded.*",
    ],
    guessMethodArguments: "insertBestGuessedArguments",
    matchCase: "firstLetter",
    importOrder: ["#", "java", "javax", "org", "com", ""],
    lazyResolveTextEdit: { enabled: true },
    maxResults: 0,
    collapseCompletionItems: false,
  },
  signatureHelp: { enabled: true, description: { enabled: false } },
  sources: { organizeImports: { starThreshold: 99, staticStarThreshold: 99 } },
  quickfix: { showAt: "line" },
  saveActions: { cleanup: true, organizeImports: false },
  cleanup: { actions: ["renameFileToType"] },
  codeGeneration: {
    insertionLocation: "afterCursor",
    useBlocks: false,
    generateComments: false,
  },
  hover: { javadoc: { enabled: true } },
  referencesCodeLens: { enabled: false, includeFields: false },
  implementationCodeLens: "none",
  references: {
    includeAccessors: true,
    includeDeclarations: true,
    includeDecompiledSources: true,
  },
  symbols: { includeSourceMethodDeclarations: false, includeGeneratedCode: false },
  inlayHints: {
    parameterNames: {
      enabled: "literals",
      suppressWhenSameNameNumbered: true,
      exclusions: [],
    },
  },
  search: { scope: "all" },
  eclipse: { downloadSources: false },
  maven: { downloadSources: false, updateSnapshots: false },
  foldingRange: { enabled: true },
  selectionRange: { enabled: true },
  edit: { validateAllOpenBuffersOnChanges: false },
  diagnostic: { filter: [] },
  telemetry: { enabled: false },
} as const;

const SETTINGS = { java: JAVA_SETTINGS } as const;

export const JDTLS: ServerSpec = {
  name: "jdtls",
  languages: ["java"],
  rootMarkers: [
    "pom.xml",
    "settings.gradle.kts",
    "settings.gradle",
    "build.gradle.kts",
    "build.gradle",
    ".project",
    ".classpath",
  ],
  program: "jdtls",
  probe: ["--help"],
  arguments: ["--jvm-arg=-Declipse.application=org.eclipse.jdt.ls.core.id1"],
  install: {
    kind: "release",
    package: "jdtls",
    version: VERSION,
    assets: {
      "darwin-arm64": asset(false),
      "darwin-x64": asset(false),
      "linux-arm64": asset(false),
      "linux-x64": asset(false),
      "win32-arm64": asset(true),
      "win32-x64": asset(true),
    },
  },
  installsOnRequest: true,
  runtime: {
    program: "java",
    probe: ["--enable-native-access=ALL-UNNAMED", "-version"],
    installHint: "Install JDK 17 or newer (for example Eclipse Temurin) and put java on PATH.",
  },
  installHint: "Install Eclipse JDT Language Server: brew install jdtls",
  initializationOptions: {
    bundles: [],
    settings: SETTINGS,
    extendedClientCapabilities: {},
  },
  settings: SETTINGS,
  async prepare(project) {
    return {
      initializationOptions: {
        bundles: [],
        workspaceFolders: [pathToFileURL(project.root).href],
        settings: SETTINGS,
        extendedClientCapabilities: {},
      },
    };
  },
};
