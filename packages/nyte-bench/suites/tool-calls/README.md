# Tool calls

Whether the chat reaches for the right tool in one round: a subagent whose answer the user wants goes to `task`, `create` is kept for work the user doesn't wait on or talks to again, and an MCP tool is called without a detour. The idea comes from T3 Code's `mcp-tool-use` eval.

The home's `mcp.json` names the `places` fixture MCP server, a read-only `search_places` tool, as a codemode server: the exposure an `mcp.json` entry gets when it names none. `mcp-direct` names it as a direct server instead.

| Case | Kind | What it checks |
| --- | --- | --- |
| `subagent-one-shot` | bad | A subagent whose answer the user wants runs as one `task`, not `create`. |
| `subagent-thread-word` | bad | "Spin up a new thread with an agent… give me its summary" is a `task` too. |
| `subagent-parallel` | bad | Two subagents at once are two `task` calls in one response, not `create` and `await` each. |
| `subagent-background` | guard | Work the user doesn't wait for goes to `create`, with no `task` or `await`. |
| `subagent-conversation` | guard | A subagent the user talks to twice is created, sent the second message and awaited by its exact id, in 3 rounds. |
| `mcp-codemode` | bad | A codemode MCP tool is called in one round and served. |
| `mcp-direct` | control | A direct MCP tool is called in one round and served. |
| `plain-read` | control | A question about one file is answered without subagents or MCP. |

## Add a case

Cases are rows in `cases.ts`. Each has a `kind`, an `experience` that says what went wrong or what must keep working, a `prompt`, the fixture `servers` and workspace `files`, and an `expect`:

- `rounds`: rounds of tool calls the chat's first turn may take, 1 when absent. Raise it only for work that needs ids from an earlier round, such as `create` then `send`.
- `calls`: tools that need at least one call that ended ok.
- `callsMustNot`: tool name patterns that must not be called by anyone.
- `served` / `servedMustNot`: fixture MCP tools (`server/tool`) that must, or servers that must not, have served a call.
- `answer`: text the chat's last message holds.
