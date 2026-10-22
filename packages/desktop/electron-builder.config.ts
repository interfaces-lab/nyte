import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sign } from "@electron/osx-sign";
import { Arch } from "electron-builder";
import type { AfterPackContext, Configuration, MacConfiguration } from "electron-builder";
import { ACCOUNT_SCHEMES } from "./src/account/scheme.ts";
import packageMetadata from "./package.json" with { type: "json" };

const updateTest = process.env["NYTE_UPDATE_TEST"] === "1";

const version = process.env["NYTE_RELEASE_VERSION"] ?? packageMetadata.version;

const nightly = version.includes("-nightly.");

const productName = updateTest ? "Nyte Update Test" : "Nyte";

const CLI = [
  { from: "../tui/dist/nyte", to: "nyte" },
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
  const cli = join(resources, "nyte");
  const images = nativeImages(await readFile(cli));
  const wrong = images.filter((image) => image.arch !== arch);

  if (images[0]?.offset !== 0) throw new Error(`The bundled ${cli} is not a native executable.`);

  if (wrong.length > 0)
    throw new Error(
      `The bundled ${cli} must hold only ${arch} code, but has ${wrong.map((image) => `${image.arch} at byte ${String(image.offset)}`).join(", ")}.`,
    );
  const version = context.packager.appInfo.version;
  const stated = (await readFile(join(resources, "nyte.version"), "utf8")).trim();
  const reported = execFileSync(cli, ["--version"], { encoding: "utf8" }).trim();

  if (stated !== version || reported !== version)
    throw new Error(
      `The bundled nyte is ${reported} and its nyte.version says ${stated}, but Nyte is ${version}.`,
    );
}

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
  extraResources: CLI,
  sign: (options) =>
    sign({
      ...options,
      optionsForFile: (file) => {
        const defaults = options.optionsForFile?.(file) ?? {};

        return file === join(options.app, "Contents", "Resources", "nyte")
          ? { ...defaults, entitlements: CLI_ENTITLEMENTS }
          : defaults;
      },
    }),
} satisfies MacConfiguration;

export default {
  appId: updateTest ? "ai.nyte.desktop.update-test" : "ai.nyte.desktop",
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
  // Claude Code runs the user's installed `claude`, so the SDK's ~230 MB platform binaries stay out.
  files: ["out/**/*", "package.json", "!**/node_modules/@anthropic-ai/claude-agent-sdk-*/**/*"],
  asarUnpack: ["node_modules/@lydell/**/*", "node_modules/@anthropic-ai/claude-agent-sdk*/**/*"],
  extraResources: [
    { from: "resources/adblock.bin", to: "adblock.bin" },
    { from: "../app/dist", to: "app" },
    { from: "../canvas/dist/shell", to: "canvas" },
  ],
  mac: updateTest ? { ...mac, notarize: false } : mac,
  afterPack: verifyBundledCli,
  linux: {
    target: ["AppImage"],
    category: "Development",
    executableName: productName,
    extraResources: CLI,
  },
  win: { target: ["nsis"], executableName: productName },
} satisfies Configuration;
