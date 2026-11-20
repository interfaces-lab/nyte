import type { PackagedBuild } from "../desktop-builds.ts";

export const ACCOUNT_HOST = "account";

export const CANVAS_HOST = "canvas";

export const MEDIA_HOST = "media";

export const DEVELOPMENT_ACCOUNT_SCHEME = "nyte-desktop-dev";

export function accountScheme(build: PackagedBuild | null) {
  return build?.accountScheme ?? DEVELOPMENT_ACCOUNT_SCHEME;
}

export function signedInPage(scheme: ReturnType<typeof accountScheme>): string {
  return `https://nyte.sh/desktop/signed-in?app=${scheme}`;
}
