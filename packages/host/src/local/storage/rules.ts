export const PROJECT_ARTIFACTS: ReadonlySet<string> = new Set([
  "node_modules",
  ".turbo",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".astro",
  ".angular",
  ".vite",
  ".parcel-cache",
  ".expo",
  ".cxx",
  ".dart_tool",
  ".gradle",
  ".build",
  ".zig-cache",
  "zig-out",
  "dist",
  "build",
  "coverage",
  "target",
  "DerivedData",
  "Pods",
  "venv",
  ".venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".tox",
  ".nox",
  ".terragrunt-cache",
]);

export const PROJECT_ROOTS: readonly string[] = [
  "Developer",
  "Development",
  "Projects",
  "GitHub",
  "Code",
  "dev",
  "Workspace",
  "Repos",
  "www",
];

export const AGENT_WORKTREE_ROOTS: readonly string[] = [
  ".codex/worktrees",
  ".claude/worktrees",
  ".t3/worktrees",
];

export type ToolCache = {
  readonly id: string;
  readonly title: string;
  readonly busy: readonly string[];
} & (
  | { readonly kind: "folders"; readonly folders: readonly string[] }
  | {
      readonly kind: "command";
      readonly file: string;
      readonly args: readonly string[];
      readonly probe?: {
        readonly args: readonly string[];
        readonly finds: (stdout: string) => boolean;
      };
    }
);

const XCODE = ["Xcode", "xcodebuild"];

export const TOOL_CACHES: readonly ToolCache[] = [
  {
    id: "npm",
    title: "npm cache",
    busy: ["npm", "npx"],
    kind: "folders",
    folders: [".npm/_cacache"],
  },
  {
    id: "pnpm",
    title: "pnpm store",
    busy: ["pnpm"],
    kind: "command",
    file: "pnpm",
    args: ["store", "prune"],
  },
  {
    id: "bun",
    title: "Bun cache",
    busy: ["bun"],
    kind: "folders",
    folders: [".bun/install/cache"],
  },
  {
    id: "yarn",
    title: "Yarn cache",
    busy: ["yarn"],
    kind: "folders",
    folders: ["Library/Caches/Yarn", ".cache/yarn"],
  },
  {
    id: "xcode-derived-data",
    title: "Xcode DerivedData",
    busy: XCODE,
    kind: "folders",
    folders: ["Library/Developer/Xcode/DerivedData"],
  },
  {
    id: "xcode-device-support",
    title: "Xcode device support",
    busy: XCODE,
    kind: "folders",
    folders: [
      "Library/Developer/Xcode/iOS DeviceSupport",
      "Library/Developer/Xcode/watchOS DeviceSupport",
      "Library/Developer/Xcode/tvOS DeviceSupport",
      "Library/Developer/Xcode/visionOS DeviceSupport",
    ],
  },
  {
    id: "simulator-caches",
    title: "Simulator caches",
    busy: ["Simulator", ...XCODE],
    kind: "folders",
    folders: ["Library/Developer/CoreSimulator/Caches"],
  },
  {
    id: "unavailable-simulators",
    title: "Unavailable simulators",
    busy: ["Simulator", ...XCODE],
    kind: "command",
    file: "xcrun",
    args: ["simctl", "delete", "unavailable"],
    probe: {
      args: ["simctl", "list", "devices", "unavailable", "--json"],
      finds: (stdout) => stdout.includes('"udid"'),
    },
  },
  {
    id: "go",
    title: "Go build cache",
    busy: ["go"],
    kind: "folders",
    folders: ["Library/Caches/go-build", ".cache/go-build"],
  },
  {
    id: "pip",
    title: "pip cache",
    busy: ["pip", "pip3"],
    kind: "folders",
    folders: ["Library/Caches/pip", ".cache/pip"],
  },
  {
    id: "uv",
    title: "uv cache",
    busy: ["uv"],
    kind: "folders",
    folders: [".cache/uv"],
  },
  {
    id: "homebrew",
    title: "Homebrew downloads",
    busy: ["brew"],
    kind: "folders",
    folders: ["Library/Caches/Homebrew"],
  },
  {
    id: "cocoapods",
    title: "CocoaPods cache",
    busy: ["pod"],
    kind: "folders",
    folders: ["Library/Caches/CocoaPods"],
  },
  {
    id: "build-tools",
    title: "Build tool caches",
    busy: [],
    kind: "folders",
    folders: [
      ".cache/typescript",
      ".cache/node-gyp",
      ".turbo/cache",
      ".cache/vite",
      ".cache/webpack",
      ".cache/eslint",
      ".cache/prettier",
      ".cache/electron",
    ],
  },
];
