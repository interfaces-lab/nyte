function e2ePort(value: string | undefined): number {
  if (value === undefined) return 5181;
  const port = Number(value);

  if (!/^\d+$/u.test(value) || port < 1 || port > 65_535) {
    throw new Error(`NYTE_E2E_PORT must be a TCP port from 1 to 65535, not "${value}"`);
  }

  return port;
}

/** Where the web project's server listens, shared by the config, the server, and the specs. */
export const E2E_PORT = e2ePort(process.env.NYTE_E2E_PORT);

export const E2E_ORIGIN = `http://127.0.0.1:${String(E2E_PORT)}`;

export const E2E_TOKEN = process.env.NYTE_E2E_TOKEN ?? "nyte-e2e-token-0123456789abcdef0";

export function pairingLink(token: string): string {
  return `${E2E_ORIGIN}/pair#host=${encodeURIComponent(E2E_ORIGIN)}&token=${encodeURIComponent(token)}`;
}

/** Archived chats the server seeds; 22 pages as 5, then 8 more, then the last 9 at once. */
export const ARCHIVED_SESSION_COUNT = 22;
