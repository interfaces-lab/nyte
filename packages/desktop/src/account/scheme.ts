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
