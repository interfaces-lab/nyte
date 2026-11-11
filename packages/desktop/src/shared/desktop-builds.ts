export const PACKAGED_BUILDS = {
  production: {
    name: "Nyte",
    appId: "ai.nyte.desktop",
    accountScheme: "nyte-desktop",
    homeInUserData: false,
    host: "login-item",
  },
  updateTest: {
    name: "Nyte Update Test",
    appId: "ai.nyte.desktop.update-test",
    accountScheme: "nyte-desktop-test",
    homeInUserData: true,
    host: "login-item",
  },
  bench: {
    name: "Nyte Bench",
    appId: "ai.nyte.desktop.bench",
    accountScheme: "nyte-desktop-bench",
    homeInUserData: false,
    host: "detached",
  },
} as const;

export type PackagedBuild = (typeof PACKAGED_BUILDS)[keyof typeof PACKAGED_BUILDS];

export function findPackagedBuild(name: string): PackagedBuild {
  const build = Object.values(PACKAGED_BUILDS).find((candidate) => candidate.name === name);

  if (build === undefined) throw new Error(`No packaged Nyte build is named ${name}.`);

  return build;
}
