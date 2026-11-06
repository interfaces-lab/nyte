import type { ConfigContext, ExpoConfig } from "expo/config";
import { version } from "./package.json";

type AppVariant = "development" | "preview" | "production";

function resolveVariant(value: string | undefined): AppVariant {
  return value === "development" || value === "preview" ? value : "production";
}

const VARIANTS = {
  development: { name: "Nyte Dev", scheme: "nyte-dev", suffix: ".dev" },
  preview: { name: "Nyte Preview", scheme: "nyte-preview", suffix: ".preview" },
  production: { name: "Nyte", scheme: "nyte", suffix: "" },
} as const;

function apsEnvironment(variant: AppVariant): "development" | "production" {
  return variant === "development" ? "development" : "production";
}

function runtimeVersion(variant: AppVariant): ExpoConfig["runtimeVersion"] {
  return variant === "development" ? { policy: "appVersion" } : { policy: "fingerprint" };
}

function infoPlist(
  variant: AppVariant,
  base: NonNullable<ExpoConfig["ios"]>["infoPlist"],
): NonNullable<ExpoConfig["ios"]>["infoPlist"] {
  return variant === "development"
    ? { ...base, NSAppTransportSecurity: { NSAllowsArbitraryLoads: true } }
    : base;
}

const VARIANT_PLUGINS = new Set<string | undefined>(["@use-voltra/ios-client", "expo-dev-client"]);

export default ({ config }: ConfigContext): ExpoConfig => {
  const variantName = resolveVariant(process.env.APP_VARIANT);
  const variant = VARIANTS[variantName];
  const bundleIdentifier = `dev.nyte.ios${variant.suffix}`;
  const basePlugins = config.plugins ?? [];

  return {
    ...config,
    name: variant.name,
    version,
    slug: config.slug ?? "nyte-ios",
    scheme: variant.scheme,
    runtimeVersion: runtimeVersion(variantName),
    ios: {
      ...config.ios,
      bundleIdentifier,
      infoPlist: infoPlist(variantName, config.ios?.infoPlist),
    },
    extra: withoutGeneratedExtensions(config.extra),
    plugins: [
      ...basePlugins.filter(
        (plugin) => !VARIANT_PLUGINS.has(Array.isArray(plugin) ? plugin[0] : plugin),
      ),
      ["expo-dev-client", { addGeneratedScheme: variantName === "development" }],
      [
        "@use-voltra/ios-client",
        {
          groupIdentifier: `group.${bundleIdentifier}`,
          enablePushNotifications: true,
        },
      ],
      ["./plugins/with-aps-environment.cjs", { environment: apsEnvironment(variantName) }],
    ],
  };
};

function withoutGeneratedExtensions(extra: ExpoConfig["extra"]): ExpoConfig["extra"] {
  if (extra === undefined) return undefined;
  const eas: unknown = extra["eas"];

  if (eas === null || typeof eas !== "object") return extra;
  const keptEas = Object.fromEntries(Object.entries(eas).filter(([key]) => key !== "build"));

  return { ...extra, eas: keptEas };
}
