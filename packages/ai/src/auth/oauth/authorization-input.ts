/**
 * Parse a pasted authorization code: a redirect URL, `code#state`, a
 * `code=...&state=...` query string, or a bare code. Browser-safe.
 */
export function parseAuthorizationInput(input: string) {
  const value = input.trim();

  if (!value) return {};

  try {
    const url = new URL(value);

    return {
      code: url.searchParams.get("code") ?? undefined,
      state: url.searchParams.get("state") ?? undefined,
    };
  } catch {}

  if (value.includes("#")) {
    const [code, state] = value.split("#", 2);

    return { code, state };
  }

  if (value.includes("code=")) {
    const params = new URLSearchParams(value);

    return {
      code: params.get("code") ?? undefined,
      state: params.get("state") ?? undefined,
    };
  }

  return { code: value };
}
