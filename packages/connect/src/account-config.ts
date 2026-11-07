import { namesBrokerOrigin } from "./encoding.ts";

export interface AccountConfig {
  readonly publishableKey: string;
  readonly origin: string;
}

const PUBLISHABLE_KEY = /^pk_(?:test|live)_([A-Za-z0-9+/]+={0,2})$/u;

const FRONTEND_API =
  /^(?=.{1,253}\$$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+\$$/iu;

function parsesAsPublishableKey(key: string): boolean {
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

  if (!parsesAsPublishableKey(publishableKey) || !namesBrokerOrigin(origin)) return undefined;

  return { publishableKey, origin };
}
