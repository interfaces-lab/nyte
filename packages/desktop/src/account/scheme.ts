/**
 * The renderer's origin in a packaged build, and the deep link Clerk's OAuth
 * callback returns to. Each variant owns its scheme, so the OS hands a
 * callback to the build that asked for it.
 *
 * electron-builder imports this file, so it stays free of Electron imports.
 */
export const ACCOUNT_HOST = "account";

export const ACCOUNT_SCHEMES = {
  production: "nyte-desktop",
  updateTest: "nyte-desktop-test",
  development: "nyte-desktop-dev",
} as const;

export function accountScheme(build: { readonly packaged: boolean; readonly updateTest: boolean }) {
  if (!build.packaged) return ACCOUNT_SCHEMES.development;

  return build.updateTest ? ACCOUNT_SCHEMES.updateTest : ACCOUNT_SCHEMES.production;
}

/**
 * Where the browser lands after Clerk's OAuth callback: a page that opens the
 * deep link and says to return to Nyte, instead of a tab that never finishes.
 * `app` names the build the deep link opens.
 */
export function signedInPage(scheme: ReturnType<typeof accountScheme>): string {
  return `https://nyte.sh/desktop/signed-in?app=${scheme}`;
}
