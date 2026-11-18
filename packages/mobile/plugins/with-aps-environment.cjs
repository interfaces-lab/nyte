const { withEntitlementsPlist } = require("expo/config-plugins");

const ENVIRONMENTS = new Set(["development", "production"]);

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
