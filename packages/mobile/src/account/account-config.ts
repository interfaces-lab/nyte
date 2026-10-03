import { isBrokerOrigin } from "@nyte-ai/connect";

/**
 * What a build needs to offer Nyte account sign-in. A build missing any of it
 * offers address-and-token connections only.
 */
export interface AccountConfig {
  readonly publishableKey: string;
  /** The broker and relay, a canonical `https://` origin. */
  readonly origin: string;
}

const PUBLISHABLE_KEY = /^pk_(?:test|live)_([A-Za-z0-9+/]+={0,2})$/u;

/** A bare DNS name with at least two labels: no scheme, port, path, or `$`. */
const FRONTEND_API =
  /^(?=.{1,253}\$$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+\$$/iu;

/**
 * `pk_test_` or `pk_live_`, then standard base64 of the Frontend API host and
 * a trailing `$`, as the desktop's account policy checks it. ClerkProvider
 * throws during render on a key it cannot parse, so a malformed key turns the
 * account off instead.
 */
function isPublishableKey(key: string): boolean {
  const encoded = PUBLISHABLE_KEY.exec(key)?.[1];

  if (encoded === undefined) return false;

  try {
    return FRONTEND_API.test(atob(encoded));
  } catch {
    return false;
  }
}

export function parseAccountConfig(input: {
  readonly publishableKey: string | undefined;
  readonly origin: string | undefined;
}): AccountConfig | undefined {
  const { publishableKey, origin } = input;

  if (publishableKey === undefined || origin === undefined) return undefined;

  if (!isPublishableKey(publishableKey) || !isBrokerOrigin(origin)) return undefined;

  return { publishableKey, origin };
}

/** Expo inlines `EXPO_PUBLIC_*` only where it is read by its full literal name. */
export function readAccountConfig(): AccountConfig | undefined {
  return parseAccountConfig({
    publishableKey: process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY,
    origin: process.env.EXPO_PUBLIC_NYTE_CONNECT_ORIGIN,
  });
}
