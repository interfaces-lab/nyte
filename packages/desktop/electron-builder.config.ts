import type { Configuration } from "electron-builder";

export default {
  appId: "ai.nyte.desktop",
  productName: "Nyte",
  artifactName: "Nyte-${version}-${os}-${arch}.${ext}",
  publish: { provider: "github", owner: "interfaces-lab", repo: "nyte", releaseType: "release" },
  directories: { output: "dist", buildResources: "build" },
  files: ["out/**/*", "package.json"],
  asarUnpack: ["node_modules/@lydell/**/*"],
  extraResources: [{ from: "resources/adblock.bin", to: "adblock.bin" }],
  mac: {
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
  },
  linux: { target: ["AppImage"], category: "Development" },
  win: { target: ["nsis"] },
} satisfies Configuration;
