import { operationsDigest } from "@nyte-ai/protocol";

/**
 * Returns the build identity a service registers and a client expects: the package `version`,
 * then the operations digest and, when known, `code`, the id of the code the build runs, each
 * after a `+`. A client whose operations or code changed never attaches to a service built
 * before the change.
 */
export async function serviceBuild(version: string, code: string | undefined): Promise<string> {
  const build = `${version}+${await operationsDigest()}`;

  return code === undefined ? build : `${build}+${code}`;
}
