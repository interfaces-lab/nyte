import type {
  findTailnetAddress as findRealTailnetAddress,
  serveTailnet as serveRealTailnet,
} from "../tailnet.ts";

export const findTailnetAddress: typeof findRealTailnetAddress = async () => ({
  kind: "ready",
  cli: "tailscale",
  address: { ip: "100.64.0.1", name: "nyte-e2e.tailnet.ts.net", https: true },
});

export const serveTailnet: typeof serveRealTailnet = async (port) => ({
  address: `http://127.0.0.1:${String(port)}`,
  stop: async () => {},
});
