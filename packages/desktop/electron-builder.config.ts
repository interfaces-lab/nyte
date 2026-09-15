import type { Configuration } from "electron-builder";
import { electronSparkle } from "electron-sparkle/electron-builder";

const updateTest = process.env["NYTE_UPDATE_TEST"] === "1";
const publicKey =
  process.env["NYTE_SPARKLE_PUBLIC_KEY"] ??
  (updateTest ? undefined : "u6NmdrN0PD5XXdy2KJyUfyvzB3hCtI3+6Gf1bg8IYDc=");

export default {
  appId: updateTest ? "ai.nyte.desktop.update-test" : "ai.nyte.desktop",
  productName: updateTest ? "Nyte Update Test" : "Nyte",
  extraMetadata: { productName: updateTest ? "Nyte Update Test" : "Nyte" },
  beforePack: (context) => {
    if (context.electronPlatformName !== "darwin") return;
    if (
      publicKey === undefined ||
      !/^[A-Za-z0-9+/]{43}=$/u.test(publicKey) ||
      Buffer.from(publicKey, "base64").length !== 32
    ) {
      throw new Error(
        "Set NYTE_SPARKLE_PUBLIC_KEY to the Sparkle Ed25519 public key before packaging macOS.",
      );
    }
  },
  afterPack: electronSparkle,
  artifactName: "Nyte-${version}-${os}-${arch}.${ext}",
  publish: { provider: "github", owner: "interfaces-lab", repo: "nyte", releaseType: "release" },
  directories: { output: "dist", buildResources: "build" },
  files: [
    "out/**/*",
    "package.json",
    // The afterPack hook reads this archive from node_modules and copies the extracted
    // framework into Contents/Frameworks, where electron-builder signs it. The `.node`
    // addons beside it make electron-builder unpack the whole module out of the asar, so
    // the archive ships too, and notarization rejects the ad-hoc-signed binaries Apple
    // finds when it recurses into it.
    "!node_modules/electron-sparkle/dist/Sparkle-*.zip",
  ],
  asarUnpack: ["node_modules/@lydell/**/*"],
  extraResources: [{ from: "resources/adblock.bin", to: "adblock.bin" }],
  mac: {
    category: "public.app-category.developer-tools",
    icon: "build/icon.icns",
    target: [
      { target: "dmg", arch: ["arm64"] },
      { target: "zip", arch: ["arm64"] },
    ],
    hardenedRuntime: !updateTest,
    forceCodeSigning: true,
    ...(updateTest ? { identity: "-", notarize: false } : {}),
    extendInfo: {
      SUFeedURL: updateTest
        ? "http://localhost:8917/appcast.xml"
        : "https://github.com/interfaces-lab/nyte/releases/download/desktop-updates/appcast.xml",
      SUPublicEDKey: publicKey,
      SUEnableAutomaticChecks: false,
      SUAutomaticallyUpdate: false,
      ...(updateTest ? { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } } : {}),
    },
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
  },
  linux: { target: ["AppImage"], category: "Development" },
  win: { target: ["nsis"] },
} satisfies Configuration;
