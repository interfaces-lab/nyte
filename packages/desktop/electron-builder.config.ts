import type { Configuration, MacConfiguration } from "electron-builder";
import { ACCOUNT_SCHEMES } from "./src/account/scheme.ts";

const updateTest = process.env["NYTE_UPDATE_TEST"] === "1";

const productName = updateTest ? "Nyte Update Test" : "Nyte";

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
} satisfies MacConfiguration;

export default {
  appId: updateTest ? "ai.nyte.desktop.update-test" : "ai.nyte.desktop",
  productName,
  // Workspace name is `@nyte-ai/desktop`. electron-builder would otherwise emit
  // `@nyte-aidesktop`, which AppImage and NSIS reject as an executable name.
  executableName: productName,
  extraMetadata: { name: productName, productName },
  artifactName: "Nyte-${version}-${os}-${arch}.${ext}",
  // Clerk's OAuth callback returns here. macOS reads it from Info.plist and Linux from
  // the .desktop entry; Windows registers it at run time.
  protocols: {
    name: productName,
    schemes: [updateTest ? ACCOUNT_SCHEMES.updateTest : ACCOUNT_SCHEMES.production],
  },
  // The update test serves its own release from scripts/update-test.mjs.
  publish: updateTest
    ? { provider: "generic", url: "http://localhost:8917" }
    : { provider: "github", owner: "interfaces-lab", repo: "nyte", releaseType: "release" },
  directories: { output: "dist", buildResources: "build" },
  files: ["out/**/*", "package.json"],
  asarUnpack: ["node_modules/@lydell/**/*"],
  extraResources: [
    { from: "resources/adblock.bin", to: "adblock.bin" },
    // The web app Remote access serves beside the API; scripts/build.mjs builds it first.
    { from: "../app/dist", to: "app" },
    // The canvas runtime shell, served on the renderer scheme's `canvas` host.
    { from: "../canvas/dist/shell", to: "canvas" },
  ],
  // Squirrel.Mac installs only an update signed by the running app's Developer ID.
  mac: updateTest ? { ...mac, notarize: false } : mac,
  linux: {
    target: ["AppImage"],
    category: "Development",
    executableName: productName,
  },
  win: { target: ["nsis"], executableName: productName },
} satisfies Configuration;
