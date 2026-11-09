import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sign } from "@electron/osx-sign";
import { Arch } from "electron-builder";
import type { AfterPackContext, Configuration, MacConfiguration } from "electron-builder";
import { ACCOUNT_SCHEMES } from "./src/shared/account/scheme.ts";
import {
  bundledHostAgentJob,
  DESKTOP_APP_IDS,
  hostAgentPlist,
} from "./src/shared/host-agent-job.ts";
import packageMetadata from "./package.json" with { type: "json" };

const updateTest = process.env["NYTE_UPDATE_TEST"] === "1";

const version = process.env["NYTE_RELEASE_VERSION"] ?? packageMetadata.version;

const nightly = version.includes("-nightly.");

const productName = updateTest ? "Nyte Update Test" : "Nyte";

const appId = updateTest ? DESKTOP_APP_IDS.updateTest : DESKTOP_APP_IDS.production;

const CLI = [
  { from: "../tui/dist/nyte", to: "nyte" },
  { from: "../tui/dist/nyte-tailnet", to: "nyte-tailnet" },
  { from: "../tui/dist/nyte.version", to: "nyte.version" },
];

const CLI_ENTITLEMENTS = join(import.meta.dirname, "..", "tui", "entitlements.plist");

const MACH_O = Buffer.from("cffaedfe", "hex");

const ELF = Buffer.from("7f454c46", "hex");

const MACH_O_CPUS = new Map([
  [0x0100000c, "arm64"],
  [0x01000007, "x64"],
  [12, "arm"],
  [7, "x86"],
]);

const ELF_MACHINES = new Map([
  [183, "arm64"],
  [62, "x64"],
  [40, "arm"],
  [3, "x86"],
]);

function* offsets(bytes: Buffer, magic: Buffer, length: number): Generator<number> {
  for (let at = 0; at + length <= bytes.length; at++)
    if (bytes[at] === magic[0] && bytes.subarray(at, at + magic.length).equals(magic)) yield at;
}

function nativeImages(bytes: Buffer): { readonly offset: number; readonly arch: string }[] {
  const images: { readonly offset: number; readonly arch: string }[] = [];

  for (const at of offsets(bytes, MACH_O, 8)) {
    const arch = MACH_O_CPUS.get(bytes.readUInt32LE(at + 4));

    if (arch !== undefined) images.push({ offset: at, arch });
  }

  for (const at of offsets(bytes, ELF, 24)) {
    const width = bytes[at + 4];
    const order = bytes[at + 5];

    if ((width !== 1 && width !== 2) || (order !== 1 && order !== 2) || bytes[at + 6] !== 1)
      continue;
    const little = order === 1;
    const machine = little ? bytes.readUInt16LE(at + 18) : bytes.readUInt16BE(at + 18);

    if ((little ? bytes.readUInt32LE(at + 20) : bytes.readUInt32BE(at + 20)) === 1)
      images.push({ offset: at, arch: ELF_MACHINES.get(machine) ?? `machine ${String(machine)}` });
  }

  return images.toSorted((left, right) => left.offset - right.offset);
}

async function verifyBundledCli(context: AfterPackContext): Promise<void> {
  if (context.electronPlatformName === "win32") return;
  const arch = Arch[context.arch];
  const resources = context.packager.getResourcesDir(context.appOutDir);
  const version = context.packager.appInfo.version;
  const stated = (await readFile(join(resources, "nyte.version"), "utf8")).trim();

  for (const name of ["nyte", "nyte-tailnet"]) {
    const cli = join(resources, name);
    const images = nativeImages(await readFile(cli));
    const wrong = images.filter((image) => image.arch !== arch);

    if (images[0]?.offset !== 0) throw new Error(`The bundled ${cli} is not a native executable.`);

    if (wrong.length > 0)
      throw new Error(
        `The bundled ${cli} must hold only ${arch} code, but has ${wrong.map((image) => `${image.arch} at byte ${String(image.offset)}`).join(", ")}.`,
      );
    const reported = execFileSync(cli, ["--version"], { encoding: "utf8" }).trim();

    if (stated !== version || reported !== version)
      throw new Error(
        `The bundled ${name} is ${reported} and its nyte.version says ${stated}, but Nyte is ${version}.`,
      );
  }
}

async function bundleHostAgent(context: AfterPackContext): Promise<void> {
  if (context.electronPlatformName !== "darwin") return;

  const job = bundledHostAgentJob({
    appId,
    executable: context.packager.appInfo.productFilename,
  });

  const agents = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    "Contents",
    "Library",
    "LaunchAgents",
  );

  await mkdir(agents, { recursive: true });
  await writeFile(join(agents, `${job.label}.plist`), hostAgentPlist(job));
}

const SOURCE_TYPES = [
  { name: "Plain Text", extensions: ["txt", "text", "log", "csv", "tsv", "diff", "patch"] },
  { name: "Markdown", extensions: ["md", "markdown", "mdx"] },
  {
    name: "Configuration",
    extensions: ["json", "jsonc", "json5", "yaml", "yml", "toml", "ini", "cfg", "conf", "env"],
  },
  { name: "Markup", extensions: ["html", "htm", "xml", "svg", "css", "scss", "sass", "less"] },
  {
    name: "JavaScript",
    extensions: ["js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx", "vue", "svelte", "astro"],
  },
  { name: "Shell Script", extensions: ["sh", "bash", "zsh", "fish", "ps1"] },
  {
    name: "Source Code",
    extensions: [
      "py",
      "pyi",
      "rb",
      "go",
      "rs",
      "java",
      "kt",
      "kts",
      "scala",
      "swift",
      "c",
      "h",
      "cc",
      "cpp",
      "cxx",
      "hpp",
      "m",
      "mm",
      "cs",
      "php",
      "lua",
      "dart",
      "ex",
      "exs",
      "erl",
      "hs",
      "ml",
      "mli",
      "clj",
      "cljs",
      "r",
      "jl",
      "zig",
      "nix",
      "sql",
      "graphql",
      "gql",
      "proto",
      "tf",
      "hcl",
      "cmake",
      "mk",
      "gradle",
    ],
  },
] as const;

/** Finder's Open With: text and source files, and folders. No `LSHandlerRank`, so Nyte is never the default. */
const DOCUMENT_TYPES = [
  ...SOURCE_TYPES.map((type) => ({
    CFBundleTypeName: type.name,
    CFBundleTypeRole: "Editor",
    CFBundleTypeOSTypes: ["****"],
    CFBundleTypeExtensions: type.extensions,
  })),
  { CFBundleTypeName: "Folder", CFBundleTypeRole: "Editor", LSItemContentTypes: ["public.folder"] },
];

const mac = {
  category: "public.app-category.developer-tools",
  icon: "build/icon.icns",
  target: [
    { target: "dmg", arch: ["arm64"] },
    { target: "zip", arch: ["arm64"] },
  ],
  hardenedRuntime: true,
  forceCodeSigning: true,
  entitlements: "build/entitlements.mac.plist",
  entitlementsInherit: "build/entitlements.mac.plist",
  extendInfo: { CFBundleDocumentTypes: DOCUMENT_TYPES },
  extraResources: [
    ...CLI,
    { from: "resources/icon.png", to: "icon.png" },
    { from: "resources/trayTemplate.png", to: "trayTemplate.png" },
    { from: "resources/trayTemplate@2x.png", to: "trayTemplate@2x.png" },
  ],
  sign: (options) =>
    sign({
      ...options,
      optionsForFile: (file) => {
        const defaults = options.optionsForFile?.(file) ?? {};

        if (file === join(options.app, "Contents", "Resources", "nyte"))
          return { ...defaults, entitlements: CLI_ENTITLEMENTS };

        return file === join(options.app, "Contents", "Resources", "nyte-tailnet")
          ? { ...defaults, entitlements: [] }
          : defaults;
      },
    }),
} satisfies MacConfiguration;

export default {
  appId,
  productName,
  executableName: productName,
  extraMetadata: { name: productName, productName, version },
  artifactName: "Nyte-${version}-${os}-${arch}.${ext}",
  protocols: {
    name: productName,
    schemes: [updateTest ? ACCOUNT_SCHEMES.updateTest : ACCOUNT_SCHEMES.production],
  },
  publish: updateTest
    ? { provider: "generic", url: "http://localhost:8917" }
    : {
        provider: "github",
        owner: "interfaces-lab",
        repo: "nyte",
        releaseType: nightly ? "prerelease" : "release",
        channel: nightly ? "nightly" : "latest",
      },
  directories: { output: "dist", buildResources: "build" },
  files: ["out/**/*", "package.json", "!**/node_modules/@anthropic-ai/claude-agent-sdk-*/**/*"],
  asarUnpack: ["node_modules/@lydell/**/*", "node_modules/@anthropic-ai/claude-agent-sdk*/**/*"],
  extraResources: [
    { from: "resources/adblock.generated.bin", to: "adblock.bin" },
    { from: "../app/dist", to: "app" },
    { from: "../canvas/dist/shell", to: "canvas" },
  ],
  mac: updateTest ? { ...mac, notarize: false } : mac,
  dmg: {
    contents: [
      { x: 130, y: 220, type: "file" },
      { x: 410, y: 220, type: "link", path: "/Applications" },
      { x: 130, y: 540, type: "position", path: ".background.tiff" },
      { x: 410, y: 540, type: "position", path: ".VolumeIcon.icns" },
    ],
  },
  afterPack: async (context) => {
    await verifyBundledCli(context);
    await bundleHostAgent(context);
  },
  linux: {
    target: ["AppImage"],
    category: "Development",
    executableName: productName,
    extraResources: CLI,
  },
  win: { target: ["nsis"], executableName: productName },
} satisfies Configuration;
