import type { IconName } from "@nyte-ai/ui/icon";

/**
 * What the Customize page would need from the host beyond today's `PluginInfo`:
 * a display name, a one-line description, what the plugin adds, and where it
 * lives on disk. Built-in versions are content digests (`builtin:3f9a…`), so
 * the page never shows them.
 */

export type PluginSource = "builtin" | "user" | "project";

export type PluginStanding =
  | { readonly kind: "active" }
  | { readonly kind: "failed"; readonly error: string };

export interface PluginSetting {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly choices: readonly { readonly id: string; readonly label: string }[];
  readonly current: string;
}

export interface Contribution {
  readonly name: string;
  readonly description: string;
}

export interface LabPlugin {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly icon: IconName;
  readonly source: PluginSource;
  readonly version?: string;
  readonly path?: string;
  readonly standing: PluginStanding;
  readonly settings: readonly PluginSetting[];
  readonly tools: readonly Contribution[];
  readonly commands: readonly Contribution[];
}

export interface McpServer {
  readonly name: string;
  readonly command: string;
  readonly tools: number;
  readonly on: boolean;
  readonly error?: string;
}

export interface SkillFolder {
  readonly path: string;
  readonly scope: "user" | "project";
  readonly skills: readonly Contribution[];
}

export interface Inventory {
  readonly plugins: readonly LabPlugin[];
  readonly servers: readonly McpServer[];
  readonly skills: readonly SkillFolder[];
}

export const FOLDERS = {
  userPlugins: "~/.nyte/plugins",
  projectPlugins: ".nyte/plugins",
  manifest: "~/.nyte/nyte.json",
  userSkills: "~/.nyte/skills",
} as const;

const onOff = [
  { id: "on", label: "On" },
  { id: "off", label: "Off" },
] as const;

const active: PluginStanding = { kind: "active" };

const builtins: readonly LabPlugin[] = [
  {
    id: "web-search",
    name: "Web search",
    description: "Lets the agent search the web and read pages",
    icon: "globe",
    source: "builtin",
    standing: active,
    settings: [
      {
        id: "web-search",
        label: "Provider",
        description: "Used when a chat asks for a search",
        choices: [
          { id: "auto", label: "Automatic" },
          { id: "tavily", label: "Tavily" },
          { id: "parallel", label: "Parallel" },
          { id: "off", label: "Off" },
        ],
        current: "auto",
      },
    ],
    tools: [{ name: "websearch", description: "Search the web and return ranked results" }],
    commands: [],
  },
  {
    id: "codemode",
    name: "Code mode",
    description: "Runs JavaScript that batches and chains tool calls",
    icon: "brackets",
    source: "builtin",
    standing: active,
    settings: [],
    tools: [{ name: "codemode", description: "Run a script in a QuickJS sandbox" }],
    commands: [],
  },
  {
    id: "fast-mode",
    name: "Fast mode",
    description: "Priority processing on supported models",
    icon: "speed-low",
    source: "builtin",
    standing: active,
    settings: [{ id: "fast-mode", label: "Fast mode", choices: onOff, current: "off" }],
    tools: [],
    commands: [{ name: "/fast", description: "Toggle fast mode for this chat" }],
  },
  {
    id: "rename",
    name: "Chat titles",
    description: "Names a chat from its first message",
    icon: "writing",
    source: "builtin",
    standing: active,
    settings: [],
    tools: [{ name: "rename_chat", description: "Rename the current chat" }],
    commands: [{ name: "/rename", description: "Name this chat" }],
  },
  {
    id: "openai/compaction",
    name: "Compaction",
    description: "Summarises long chats so they fit the context window",
    icon: "cube",
    source: "builtin",
    standing: active,
    settings: [],
    tools: [],
    commands: [{ name: "/compact", description: "Summarise this chat now" }],
  },
];

const linear: LabPlugin = {
  id: "linear-sync",
  name: "linear-sync",
  description: "Create and update Linear issues from a chat",
  icon: "linear",
  source: "user",
  version: "0.3.1",
  path: "~/.nyte/plugins/linear-sync",
  standing: active,
  settings: [
    {
      id: "linear-sync.team",
      label: "Default team",
      choices: [
        { id: "eng", label: "Engineering" },
        { id: "design", label: "Design" },
      ],
      current: "eng",
    },
  ],
  tools: [
    { name: "linear_search", description: "Find issues by text, team, or state" },
    { name: "linear_create_issue", description: "Open an issue with a title and body" },
  ],
  commands: [{ name: "/triage", description: "Sort the inbox into teams" }],
};

const releaseNotes: LabPlugin = {
  id: "release-notes",
  name: "release-notes",
  description: "Drafts release notes from merged pull requests",
  icon: "file-text",
  source: "project",
  version: "1.0.0",
  path: "nyte/.nyte/plugins/release-notes",
  standing: active,
  settings: [],
  tools: [],
  commands: [{ name: "/release-notes", description: "Draft notes since the last tag" }],
};

export const brokenPlugin: LabPlugin = {
  id: "jira-bridge",
  name: "jira-bridge",
  description: "",
  icon: "box-3d",
  source: "user",
  version: "0.1.0",
  path: "~/.nyte/plugins/jira-bridge",
  standing: {
    kind: "failed",
    error:
      "Cannot find module 'jira-client' imported from ~/.nyte/plugins/jira-bridge/index.ts\n    at resolve (node:internal/modules/esm/resolve:854:9)",
  },
  settings: [],
  tools: [],
  commands: [],
};

export const INVENTORIES = {
  configured: {
    plugins: [brokenPlugin, linear, releaseNotes, ...builtins],
    servers: [
      { name: "github", command: "npx @modelcontextprotocol/server-github", tools: 26, on: true },
      { name: "figma", command: "https://mcp.figma.com/mcp", tools: 8, on: false },
      {
        name: "sentry",
        command: "npx @sentry/mcp-server",
        tools: 0,
        on: true,
        error: "Connection refused",
      },
    ],
    skills: [
      {
        path: "nyte/.nyte/skills",
        scope: "project",
        skills: [
          {
            name: "integrated-browser",
            description: "Read before touching browser panels in the desktop app",
          },
        ],
      },
      {
        path: "~/.agents/skills",
        scope: "user",
        skills: [
          { name: "better-ui", description: "Polishes and improves the UI in your project" },
          { name: "clean-copy", description: "Cut interface copy that shouldn't exist" },
          { name: "grilling", description: "Stress-test a plan, decision, or idea" },
        ],
      },
    ],
  },
  fresh: { plugins: builtins, servers: [], skills: [] },
} as const satisfies Record<string, Inventory>;

export type InventoryState = keyof typeof INVENTORIES;

export function sourceLabel(source: PluginSource): string {
  switch (source) {
    case "builtin":
      return "Built in";
    case "user":
      return "Your plugins";
    case "project":
      return "This project";
    default: {
      const _exhaustive: never = source;

      return _exhaustive;
    }
  }
}
