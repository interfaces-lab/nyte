/**
 * The settings pages that connect things, drawn as a hub with sources around
 * it: Profile, Providers, and Remote access. Each scene is data plus its copy;
 * `hub-settings.tsx` runs the same simulated connection for all three.
 */
import type { IconName } from "@nyte-ai/ui/icon";

export type Slot = "north-west" | "south-west" | "north-east" | "south-east";

/** The hub's silhouette: layered models, one machine, or an account badge. */
export type HubForm = "stack" | "machine" | "badge";

export interface Source {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly icon: IconName;
  readonly slot: Slot;
  /** What the row says while connecting, in order; progress walks through them. */
  readonly steps: readonly [string, ...string[]];
  readonly seconds: number;
  /** This source's share of the scene's unit once connected. */
  readonly amount: number;
  /** What the row shows once connected. */
  readonly result: string;
  /** The first attempt stops partway with this message; a retry succeeds. */
  readonly failsOnce?: string;
}

export interface Copy {
  readonly title: string;
  readonly body: string;
}

interface Plural {
  readonly one: string;
  readonly other: string;
}

export interface Scene {
  readonly id: string;
  readonly title: string;
  readonly icon: IconName;
  readonly hub: { readonly icon: IconName; readonly form: HubForm };
  /** The section title over the rows. */
  readonly list: string;
  readonly unit: Plural;
  readonly connect: string;
  readonly disconnect: string;
  readonly loading: Copy;
  readonly empty: Copy;
  readonly working: (count: number) => Copy;
  readonly partial: (count: number) => Copy;
  readonly ready: Copy;
  readonly sources: readonly [Source, Source, Source, Source];
}

export function plural(count: number, word: Plural): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? word.one : word.other}`;
}

const PROVIDER: Plural = { one: "provider", other: "providers" };

const ROUTE: Plural = { one: "route", other: "routes" };

const LINK: Plural = { one: "link", other: "links" };

export const SCENES: readonly Scene[] = [
  {
    id: "profile",
    title: "Profile",
    icon: "user",
    hub: { icon: "user", form: "badge" },
    list: "Accounts and devices",
    unit: { one: "repository", other: "repositories" },
    connect: "Connect",
    disconnect: "Unlink",
    loading: { title: "Loading your profile", body: "Checking who is signed in on this Mac" },
    empty: {
      title: "Not signed in",
      body: "Sign in to sync settings, open pull requests, and reach this Mac from your iPhone",
    },
    working: (count) => ({
      title: `Linking ${plural(count, LINK)}`,
      body: "Finish any sign-in that opened in your browser. Nyte picks up the rest",
    }),
    partial: (count) => ({
      title: `${plural(count, LINK)} set up`,
      body: "Link the rest to open pull requests and pick up chats from your phone",
    }),
    ready: {
      title: "Everything is linked",
      body: "Settings sync, pull requests open from chats, and your iPhone can reach this Mac",
    },
    sources: [
      {
        id: "nyte",
        title: "Nyte account",
        detail: "Sign in with your email",
        icon: "user-key",
        slot: "north-west",
        steps: ["Waiting for the browser", "Loading your account"],
        seconds: 3,
        amount: 0,
        result: "ada@halden.dev",
      },
      {
        id: "github",
        title: "GitHub",
        detail: "Open pull requests from chats",
        icon: "github",
        slot: "south-west",
        steps: ["Waiting for approval", "Reading repositories"],
        seconds: 4.6,
        amount: 24,
        result: "24 repositories",
      },
      {
        id: "iphone",
        title: "iPhone",
        detail: "Scan the code from the iOS app",
        icon: "phone",
        slot: "north-east",
        steps: ["Waiting for the scan", "Pairing"],
        seconds: 3.8,
        amount: 0,
        result: "Ada's iPhone",
      },
      {
        id: "sync",
        title: "Settings sync",
        detail: "Appearance, models, and shortcuts",
        icon: "refresh",
        slot: "south-east",
        steps: ["Comparing settings", "Uploading"],
        seconds: 2.6,
        amount: 0,
        result: "38 settings",
      },
    ],
  },
  {
    id: "providers",
    title: "Providers",
    icon: "box-3d",
    hub: { icon: "layers", form: "stack" },
    list: "Popular providers",
    unit: { one: "model", other: "models" },
    connect: "Connect Provider",
    disconnect: "Disconnect Provider",
    loading: { title: "Checking providers", body: "Reading saved credentials on this Mac" },
    empty: {
      title: "No providers connected",
      body: "Sign in or paste an API key. Each provider's models show up in the model picker",
    },
    working: (count) => ({
      title: `Connecting ${plural(count, PROVIDER)}`,
      body: "New chats can use each provider's models as soon as they load",
    }),
    partial: (count) => ({
      title: `${plural(count, PROVIDER)} connected`,
      body: "Their models are in the model picker",
    }),
    ready: {
      title: "Every provider is connected",
      body: "All their models are in the model picker. Pick a default for new chats in Agent",
    },
    sources: [
      {
        id: "opencode-go",
        title: "OpenCode Go",
        detail: "Low-cost subscription for everyday use",
        icon: "provider-opencode",
        slot: "north-west",
        steps: ["Waiting for the browser", "Checking subscription", "Loading models"],
        seconds: 4.2,
        amount: 24,
        result: "24 models",
      },
      {
        id: "anthropic",
        title: "Anthropic",
        detail: "Claude models from Anthropic",
        icon: "model-anthropic",
        slot: "south-west",
        steps: ["Checking the key", "Loading models"],
        seconds: 3.2,
        amount: 12,
        result: "12 models",
      },
      {
        id: "openai",
        title: "OpenAI",
        detail: "GPT and reasoning models from OpenAI",
        icon: "model-openai",
        slot: "north-east",
        steps: ["Checking the key", "Loading models"],
        seconds: 5,
        amount: 31,
        result: "31 models",
      },
      {
        id: "github-copilot",
        title: "GitHub Copilot",
        detail: "Coding models through your GitHub Copilot subscription",
        icon: "github",
        slot: "south-east",
        steps: ["Waiting for approval", "Exchanging the token", "Loading models"],
        seconds: 6,
        amount: 18,
        result: "18 models",
      },
    ],
  },
  {
    id: "remote",
    title: "Remote access",
    icon: "devices",
    hub: { icon: "imac", form: "machine" },
    list: "Routes",
    unit: { one: "device", other: "devices" },
    connect: "Start Serving",
    disconnect: "Stop Serving",
    loading: { title: "Checking remote access", body: "Looking for Tailscale and cloudflared" },
    empty: {
      title: "Remote access is off",
      body: "Serve this Mac to your phone or another browser. Pick how it can be reached",
    },
    working: (count) => ({
      title: `Opening ${plural(count, ROUTE)}`,
      body: "Nyte starts a server and issues a fresh token. The token is never written to disk",
    }),
    partial: (count) => ({
      title: `Serving over ${plural(count, ROUTE)}`,
      body: "Scan the code from the iOS app, or open the pairing link on another device",
    }),
    ready: {
      title: "Reachable from anywhere",
      body: "Every route is open. Stop any of them from its row",
    },
    sources: [
      {
        id: "local",
        title: "This Mac only",
        detail: "localhost · this Mac's browsers",
        icon: "computer",
        slot: "north-west",
        steps: ["Starting server", "Issuing token"],
        seconds: 1.8,
        amount: 1,
        result: "localhost:4317",
      },
      {
        id: "tailnet",
        title: "Over Tailscale",
        detail: "Your signed-in devices, on any network",
        icon: "devices",
        slot: "south-west",
        steps: ["Finding your tailnet", "Starting server", "Issuing token"],
        seconds: 3.4,
        amount: 3,
        result: "3 devices",
      },
      {
        id: "cloudflare",
        title: "Cloudflare tunnel",
        detail: "Your own hostname · cloudflared",
        icon: "cloudflare",
        slot: "north-east",
        steps: ["Starting cloudflared", "Opening tunnel", "Checking DNS"],
        seconds: 5.2,
        amount: 1,
        result: "nyte.halden.dev",
        failsOnce: "The tunnel didn't answer. Check cloudflared, then retry",
      },
      {
        id: "account",
        title: "Nyte account",
        detail: "Devices signed in as you",
        icon: "laptop",
        slot: "south-east",
        steps: ["Linking this Mac", "Enrolling devices"],
        seconds: 4,
        amount: 2,
        result: "2 devices",
      },
    ],
  },
];
