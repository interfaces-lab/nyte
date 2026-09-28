/** Where the web project's server listens, shared by the config, the server, and the specs. */
export const E2E_PORT = 5181;

export const E2E_ORIGIN = `http://127.0.0.1:${String(E2E_PORT)}`;

export const E2E_TOKEN = process.env.NYTE_E2E_TOKEN ?? "nyte-e2e-token-0123456789abcdef0";

export function pairingLink(token: string): string {
  return `${E2E_ORIGIN}/pair?host=${encodeURIComponent(E2E_ORIGIN)}&token=${encodeURIComponent(token)}`;
}
