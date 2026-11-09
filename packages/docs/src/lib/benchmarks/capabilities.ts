/** One side of a capability row: what the product does, and the page that shows it; null when there is nothing to show. */
export interface CapabilityCell {
  readonly text: string;
  readonly href: string | null;
}

export interface CapabilityRow {
  readonly label: string;
  readonly nyte: CapabilityCell;
  readonly eve: CapabilityCell;
}

export interface CapabilityGroup {
  readonly title: string;
  readonly rows: readonly CapabilityRow[];
}

const EVE = "https://eve.dev/docs";

/** Counted from each product's source: Nyte at this checkout, eve at commit b095152 (1.0.0-rc.6). */
export const capabilityGroups: readonly CapabilityGroup[] = [
  {
    title: "Models",
    rows: [
      {
        label: "Model providers",
        nyte: {
          text: "8 built in: Anthropic, OpenAI, ChatGPT, GitHub Copilot, OpenRouter, Vercel AI Gateway, OpenCode Zen and Go",
          href: "/docs/environment-variables",
        },
        eve: {
          text: "OpenAI and Anthropic helpers, plus any AI Gateway or AI SDK model",
          href: `${EVE}/agent-config`,
        },
      },
      {
        label: "Subscription sign-in",
        nyte: { text: "ChatGPT, Claude Pro/Max and GitHub Copilot", href: "/docs/cli" },
        eve: { text: "ChatGPT, in local development only", href: `${EVE}/agent-config` },
      },
      {
        label: "Local models",
        nyte: { text: "Custom providers in code", href: "/docs/host/deploy" },
        eve: {
          text: "Any OpenAI-compatible server, such as Ollama",
          href: `${EVE}/agent-config#use-a-local-model`,
        },
      },
    ],
  },
  {
    title: "Reaching your agent",
    rows: [
      {
        label: "Apps",
        nyte: { text: "Desktop (macOS), terminal (macOS and Linux), web and iOS", href: "/docs" },
        eve: { text: "Terminal UI, plus a Web Chat template", href: `${EVE}/guides/dev-tui` },
      },
      {
        label: "From anywhere",
        nyte: {
          text: "Nyte Connect, Tailscale or Cloudflare Tunnel, with device pairing",
          href: "/docs/remote-access",
        },
        eve: { text: "Deploy to Vercel or a Node server", href: `${EVE}/guides/deployment` },
      },
      {
        label: "Messaging channels",
        nyte: { text: "None yet", href: null },
        eve: {
          text: "12, including Slack, Discord, Teams, Telegram, GitHub and Linear",
          href: `${EVE}/channels`,
        },
      },
      {
        label: "Scripts and CI",
        nyte: { text: "Print mode with JSON output", href: "/docs/cli/print-mode" },
        eve: { text: "Client SDK and an HTTP sessions API", href: `${EVE}/guides/client` },
      },
      {
        label: "MCP",
        nyte: {
          text: "Serves host operations to other agents, and connects to MCP servers",
          href: "/docs/configure/mcp-servers",
        },
        eve: {
          text: "Serves the agent as an MCP server, and connects to MCP servers",
          href: `${EVE}/channels/mcp`,
        },
      },
      {
        label: "ACP",
        nyte: {
          text: "Runs the ACP agents installed on your machine",
          href: "/docs/configure/permissions",
        },
        eve: { text: "Lets ACP editors such as Zed drive the agent", href: `${EVE}/protocols/acp` },
      },
    ],
  },
  {
    title: "Building on it",
    rows: [
      {
        label: "Embedding",
        nyte: {
          text: "Run a host in your process, or connect to one, with the SDK",
          href: "/docs/sdk",
        },
        eve: {
          text: "Next.js, Nuxt, SvelteKit, TanStack Start and Vite integrations",
          href: `${EVE}/guides/frontend`,
        },
      },
      {
        label: "Storage",
        nyte: {
          text: "SQLite, Postgres, Cloudflare Durable Objects or memory",
          href: "/docs/host/stores-and-execution",
        },
        eve: {
          text: "Local, Postgres or Vercel Workflow",
          href: `${EVE}/guides/deployment/workflow-worlds`,
        },
      },
      {
        label: "Where commands run",
        nyte: {
          text: "Your machine, chat-only, or a sandbox you bring",
          href: "/docs/host/stores-and-execution",
        },
        eve: { text: "Vercel Sandbox, Docker, just-bash or your own", href: `${EVE}/sandbox` },
      },
      {
        label: "Extending",
        nyte: {
          text: "Plugins with 11 contribution kinds and 16 hooks, plus skills",
          href: "/docs/plugins",
        },
        eve: { text: "Tools, skills, schedules, hooks and extensions", href: `${EVE}/extensions` },
      },
      {
        label: "Other agents",
        nyte: {
          text: "Runs Claude Code and ACP agents as models",
          href: "/docs/configure/permissions",
        },
        eve: {
          text: "Calls other eve deployments as subagents",
          href: `${EVE}/guides/remote-agents`,
        },
      },
      {
        label: "Host API",
        nyte: { text: "177 typed operations", href: "/docs/sdk" },
        eve: { text: "Sessions API", href: `${EVE}/channels/eve` },
      },
    ],
  },
];
