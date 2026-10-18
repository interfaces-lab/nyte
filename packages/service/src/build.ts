import { operationsDigest } from "@nyte-ai/protocol";

export async function serviceBuild(version: string, code: string | undefined): Promise<string> {
  const build = `${version}+${await operationsDigest()}`;

  return code === undefined ? build : `${build}+${code}`;
}

export function buildOperations(build: string): string | undefined {
  return build.split("+")[1];
}
