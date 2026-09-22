/**
 * Sets the APNs environment in the entitlements.
 *
 * `@use-voltra/ios-client` writes `aps-environment: development` whenever its
 * push support is on, regardless of what is being built. A TestFlight or App
 * Store build needs `production`: device tokens are scoped to the environment
 * named here, and a token minted under the wrong one is rejected by the other
 * APNs host without an error the app can see. This plugin must be listed after
 * that one so it writes last.
 */
// Imported through `expo` rather than the bare package: `@expo/config-plugins` is
// not a direct dependency here, and pnpm's layout puts it out of reach.
const { withEntitlementsPlist } = require("expo/config-plugins");

const ENVIRONMENTS = new Set(["development", "production"]);

/** @type {import("expo/config-plugins").ConfigPlugin<{ environment: string }>} */
const withApsEnvironment = (config, props) => {
  const environment = props?.environment;

  if (!ENVIRONMENTS.has(environment)) {
    throw new Error(
      `with-aps-environment: environment must be "development" or "production", got ${String(environment)}`,
    );
  }

  return withEntitlementsPlist(config, (mod) => {
    mod.modResults["aps-environment"] = environment;

    return mod;
  });
};

module.exports = withApsEnvironment;
