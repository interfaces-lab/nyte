# Claude Code provider

Adapted from [earendil-works/pi-claude-code](https://github.com/earendil-works/pi-claude-code)
at commit `70abb65186592ca788b29b3db22c3160d629c41f`, under the [MIT license](./LICENSE).

The local host registers this example as `anthropic`, named Claude Code. Desktop
and TUI use it through the host. Claude Code handles authentication and model
requests; Nyte owns history, approvals, compaction, and tool execution.

Install Claude Code on the host's PATH, then run `claude auth login`.
The compiled TUI also needs Node.js on PATH for the inert MCP inventory.
The provider checks `claude auth status`; Nyte does not import Claude Code credentials.

```ts
import { claudeCodeProvider } from "@nyte-ai/plugin/core/claude-code";

models.setProvider(claudeCodeProvider());
```

Optional environment variables:

- `NYTE_CLAUDE_CODE_COMMAND`: executable path or command, default `claude`.
- `NYTE_CLAUDE_CODE_CONFIG_DIR`: directory passed as `CLAUDE_CONFIG_DIR`.
- `NYTE_CLAUDE_CODE_ALLOW_USAGE_CREDITS=1`: allow usage-credit overage. By default,
  an overage event stops further requests after the charged response.

Inherited API-key, endpoint, Bedrock, Vertex, and Foundry overrides are rejected.
The provider uses Claude Code's login even when an older Nyte Anthropic credential
is stored. Sign in and out through `claude auth login` and `claude auth logout`.

The relay forwards one Messages request per turn and captures the upstream
response before Claude Code processes it. An inert MCP inventory exposes Nyte's
tools without executing them in Claude Code. Transcript diagnostics preserve
signed thinking, initial reminders, and historical system/tool updates.

At most two workers are retained for five minutes. Exact linear continuations
reuse a worker; edits, branches, configuration changes, and tool calls restart it.
The built-in plugin releases workers when the session runtime closes. The inert
MCP source is embedded so it also works in desktop bundles and the TUI binary.

Models use Nyte's Anthropic catalog for pricing and Claude Code's model discovery
for availability. Complex tool schemas may be simplified, following upstream.
