import { PLACES_SERVER } from "@nyte-ai/bench";
import type { FixtureServer } from "@nyte-ai/bench";
import type { Suite } from "../../src/case.ts";

const NOTES = `Launch notes
- TODO: rename the billing page
- TODO: ship the dark mode toggle
- TODO: write the changelog
Owner: Priya
`;

const FILES = { "notes.txt": NOTES };

/** The places fixture as a codemode server, the exposure a server gets when mcp.json names none. */
const SERVERS = {
  places: { script: PLACES_SERVER, exposure: "codemode" },
} as const satisfies Readonly<Record<string, FixtureServer>>;

const TODOS = ["billing", "dark mode", "changelog"];

/** Whether the chat reaches for the right tool in one round: subagents, background agents and MCP servers. */
export const TOOL_CALLS: Suite = {
  id: "tool-calls",
  title: "Tool calls",
  cases: [
    {
      id: "subagent-one-shot",
      kind: "bad",
      experience:
        "Asked for a subagent and its answer, the agent started a background agent with create instead of running one task.",
      prompt: "Use a subagent to read notes.txt and tell me the TODO items it lists.",
      servers: SERVERS,
      files: FILES,
      expect: { calls: ["task"], callsMustNot: [/^create$/u], answer: TODOS },
    },
    {
      id: "subagent-thread-word",
      kind: "bad",
      experience:
        "Asked to start a thread with an agent and report back, the agent called create and then await, and the await named a mangled session id.",
      prompt:
        "Spin up a new thread with an agent to summarise notes.txt, then give me its summary.",
      servers: SERVERS,
      files: FILES,
      expect: { calls: ["task"], callsMustNot: [/^create$/u], answer: ["Priya"] },
    },
    {
      id: "subagent-parallel",
      kind: "bad",
      experience:
        "Asked for two subagents at once, the agent started background agents with create and awaited each instead of two task calls in one response.",
      prompt:
        "Use two subagents in parallel: one lists the TODO items in notes.txt, the other finds who owns the launch. Then give me both answers.",
      servers: SERVERS,
      files: FILES,
      expect: {
        calls: ["task"],
        callsMustNot: [/^create$/u],
        answer: [...TODOS, "Priya"],
      },
    },
    {
      id: "subagent-background",
      kind: "guard",
      experience:
        "Work the user doesn't wait for goes to a background subagent the chat leaves running.",
      prompt:
        "Start a background agent that writes a short poem about notes.txt into poem.txt. Don't wait for it; just tell me it started.",
      servers: SERVERS,
      files: FILES,
      expect: { calls: ["create"], callsMustNot: [/^task$/u, /^await$/u] },
    },
    {
      id: "subagent-conversation",
      kind: "guard",
      experience:
        "A subagent the user talks to twice is created once, sent the second message and awaited, by its exact session id.",
      prompt:
        "Start a subagent and ask it to read notes.txt. Once it has, send that same subagent a second message asking who owns the launch, and tell me its answer.",
      servers: SERVERS,
      files: FILES,
      expect: {
        rounds: 3,
        calls: ["create", "send", "await"],
        callsMustNot: [/^task$/u],
        answer: ["Priya"],
      },
    },
    {
      id: "mcp-codemode",
      kind: "bad",
      experience:
        "A codemode MCP server's tool failed to call: called directly before it was loaded, or with the wrong name or arguments.",
      prompt: "Find three places to eat near Union Square with the places tool.",
      servers: SERVERS,
      files: {},
      expect: { served: ["places/search_places"], answer: ["Luigi"] },
    },
    {
      id: "mcp-direct",
      kind: "control",
      experience:
        "A direct MCP server's tool, declared to the model upfront, is called once and works.",
      prompt: "Find three places to eat near Union Square with the places tool.",
      servers: { places: { script: PLACES_SERVER, exposure: "direct" } },
      files: {},
      expect: {
        calls: ["mcp__places__search_places"],
        served: ["places/search_places"],
        answer: ["Luigi"],
      },
    },
    {
      id: "plain-read",
      kind: "control",
      experience: "A question about one file is answered in the chat, without subagents or MCP.",
      prompt: "What are the TODO items in notes.txt?",
      servers: SERVERS,
      files: FILES,
      expect: {
        callsMustNot: [/^task$/u, /^create$/u, /^mcp__/u],
        servedMustNot: ["places"],
        answer: TODOS,
      },
    },
  ],
};
