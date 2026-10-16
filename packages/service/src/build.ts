import { operationsDigest } from "@nyte-ai/protocol";

/** Returns the build identity a service registers and a client expects: the package `version` with the operations digest as semver build metadata, so a client whose operations changed never attaches to a service built before the change. */
export async function serviceBuild(version: string): Promise<string> {
  return `${version}+${await operationsDigest()}`;
}
