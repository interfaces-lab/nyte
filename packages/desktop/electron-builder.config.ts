import type { Configuration } from "electron-builder";

export default {
  appId: "ai.nyte.desktop",
  productName: "Nyte",
  directories: { output: "dist", buildResources: "build" },
  files: ["out/**/*", "package.json"],
  asarUnpack: ["node_modules/@lydell/**/*"],
  extraResources: [{ from: "resources/adblock.bin", to: "adblock.bin" }],
  mac: { category: "public.app-category.developer-tools", icon: "build/icon.icns" },
  linux: { target: ["AppImage"], category: "Development" },
} satisfies Configuration;
