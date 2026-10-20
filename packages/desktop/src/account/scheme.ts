export const ACCOUNT_HOST = "account";

export const CANVAS_HOST = "canvas";

export const ACCOUNT_SCHEMES = {
  production: "nyte-desktop",
  updateTest: "nyte-desktop-test",
  development: "nyte-desktop-dev",
} as const;

export function accountScheme(build: { readonly packaged: boolean; readonly updateTest: boolean }) {
  if (!build.packaged) return ACCOUNT_SCHEMES.development;

  return build.updateTest ? ACCOUNT_SCHEMES.updateTest : ACCOUNT_SCHEMES.production;
}

export function signedInPage(scheme: ReturnType<typeof accountScheme>): string {
  return `https://nyte.sh/desktop/signed-in?app=${scheme}`;
}
