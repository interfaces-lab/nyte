import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * Variant overrides layered onto `app.json`, which stays the source of
 * everything the three builds share. Only what must differ per variant lives
 * here.
 *
 * The variants install side by side, so a TestFlight build and a local
 * development build can sit on one phone without replacing each other. The
 * variant comes from `APP_VARIANT`, which each EAS build profile sets; an
 * unset value means production, because that is the one a release must never
 * get wrong by omission.
 */
type AppVariant = "development" | "preview" | "production";

function resolveVariant(value: string | undefined): AppVariant {
  return value === "development" || value === "preview" ? value : "production";
}

const VARIANTS = {
  development: { name: "Nyte Dev", scheme: "nyte-dev", suffix: ".dev" },
  preview: { name: "Nyte Preview", scheme: "nyte-preview", suffix: ".preview" },
  production: { name: "Nyte", scheme: "nyte", suffix: "" },
} as const;

/**
 * APNs device tokens are scoped to the environment named in the entitlement,
 * and a token minted under one is rejected by the other without an error the
 * app can see. TestFlight and the App Store both run against production, so
 * only a development build keeps the sandbox.
 *
 * `@use-voltra/ios-client` writes `development` unconditionally whenever its
 * push support is on, so `with-aps-environment` runs after it and corrects the
 * value.
 */
function apsEnvironment(variant: AppVariant): "development" | "production" {
  return variant === "development" ? "development" : "production";
}

/**
 * Which binaries an over-the-air update is allowed to reach.
 *
 * `appVersion` matches on the version string alone, so every build sharing
 * `0.1.0` looks interchangeable. That is wrong for a distributed build: this
 * package's native side changes without the version moving, and a JavaScript
 * bundle expecting a native module the installed binary lacks crashes on
 * launch. `fingerprint` hashes native dependencies, config plugins, and
 * patches instead, so an update only reaches a binary that can run it.
 *
 * A development build keeps `appVersion` because the fingerprint would be
 * recalculated on every Metro launch for no benefit; a dev client loads local
 * bundles regardless.
 */
function runtimeVersion(variant: AppVariant): ExpoConfig["runtimeVersion"] {
  return variant === "development" ? { policy: "appVersion" } : { policy: "fingerprint" };
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const variantName = resolveVariant(process.env.APP_VARIANT);
  const variant = VARIANTS[variantName];
  const bundleIdentifier = `dev.nyte.ios${variant.suffix}`;
  const basePlugins = config.plugins ?? [];

  return {
    ...config,
    name: variant.name,
    slug: config.slug ?? "nyte-ios",
    scheme: variant.scheme,
    runtimeVersion: runtimeVersion(variantName),
    ios: { ...config.ios, bundleIdentifier },
    extra: withoutGeneratedExtensions(config.extra),
    plugins: [
      // The Voltra entry in app.json is replaced so its app group follows the
      // variant's bundle identifier; a shared group would let two variants
      // read each other's Live Activity state.
      ...basePlugins.filter((plugin) => !isVoltraPlugin(plugin)),
      [
        "@use-voltra/ios-client",
        {
          groupIdentifier: `group.${bundleIdentifier}`,
          // Lets APNs update the Live Activity while the app is suspended.
          // Nothing sends those pushes yet; see the README.
          enablePushNotifications: true,
        },
      ],
      ["./plugins/with-aps-environment.cjs", { environment: apsEnvironment(variantName) }],
    ],
  };
};

/**
 * `eas init` writes the resolved config back to `app.json`, which bakes in the
 * Live Activity extension the Voltra plugin generated for whichever variant
 * happened to resolve at the time. The plugin appends rather than replaces, so
 * keeping that copy gives a non-production build two extensions: its own and a
 * stale one holding the production bundle identifier and app group. Drop the
 * generated block and let the plugin produce it again.
 *
 * `projectId` and everything else under `extra` are written by hand or by the
 * CLI for keeps, so they survive.
 */
function withoutGeneratedExtensions(extra: ExpoConfig["extra"]): ExpoConfig["extra"] {
  if (extra === undefined) return undefined;
  const eas: unknown = extra["eas"];

  if (eas === null || typeof eas !== "object") return extra;
  const keptEas = Object.fromEntries(Object.entries(eas).filter(([key]) => key !== "build"));

  return { ...extra, eas: keptEas };
}

function isVoltraPlugin(plugin: NonNullable<ExpoConfig["plugins"]>[number]): boolean {
  const name = Array.isArray(plugin) ? plugin[0] : plugin;

  return name === "@use-voltra/ios-client";
}
