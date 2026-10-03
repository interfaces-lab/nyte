# Depend on Pi, keep Nyte's session

**Pi now has first-party MCP, code mode, and tool discovery.** The smallest complete default is an exact **`@earendil-works/pi-codemode@0.99.2` dependency**, a Nyte scoped adapter, and Nyte's existing MCP pool. Start with MCP-only code mode, local discovery, structured results, finite timeout and guest memory, cancellation, and no automatic replay. Do not preemptively copy the executor. Its hard aggregate output/call limits are absent; if those are a release requirement, contribute an upstream API or narrowly vendor the runtime. Do not import Pi's coding-agent, terminal UI, child runner, or permission policy. Nyte's unattended children are intentional; preserve their existing tool exclusions and inherited trust.

## Main source and npm expose different APIs

This report synthesizes the three supplied notes only. Their main snapshot is **`86dfceec402ad77e563bf4feab5f26c42d5f5db6`**, observed October 1, 2026. Its package manifests say `1.0.0`; the inspected registry artifacts were **`0.99.2`**, built from `005af57d88ee23b33778f343a9595b32e67ff788`. This is a dated publication observation, not a fresh check of moving main or today's registry. Published codemode lacks main's `renderToolOutputType` root export; main MCP adds OAuth hardening, `stepUpScope`, and terminal-cursor handling not all present in `0.99.2`. ([Published codemode](https://registry.npmjs.org/@earendil-works%2Fpi-codemode/0.99.2))

| Standalone package | Public APIs Nyte can use | Runtime dependencies |
| --- | --- | --- |
| `@earendil-works/pi-codemode` | `CodemodeSandbox`, `loadQuickJSWasm`, declaration rendering, identifier normalization; `/declarations`, `/source`, `/worker` exports | Only `quickjs-wasi@3.6.2` |
| `@earendil-works/pi-mcp` | `McpClient`, `StdioTransport`, `StreamableHttpTransport`, content/types/errors; `/oauth` and `/testing` | Only `cross-spawn@7.0.6` |

Both are independently published ESM packages requiring Node `>=22.19.0`, without Pi peers or workspace runtime dependencies. `CodemodeSandbox` supports registration/removal, `execute`, and `close`; constructor options include tools, globals, deadline, guest memory, WASM, and worker location. Execution accepts code, cancellation, deadline override, and a store snapshot. `/worker` starts the runtime and belongs in a dedicated worker entry. ([Codemode source](https://github.com/earendil-works/pi/tree/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/codemode))

`McpClient.listTools()` returns `Tool[]`; `callTool(name, args, options)` is not the official SDK's object-shaped call. It supports pagination, resources, notifications, cancellation, generic requests, and host-installed request handlers. OAuth needs host-owned credential storage and interaction. Pi's integration does not supply sampling/elicitation bridges, MCP tasks, legacy HTTP+SSE, or MCP Apps rendering. Its ordinary call validation is shallow, not server-output-schema validation. Replacing Nyte's SDK would therefore be a separate migration, not a prerequisite for code mode. ([MCP source](https://github.com/earendil-works/pi/tree/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/mcp))

## Pi defers declarations, then executes through session tools

Pi's CLI loads replaceable built-in MCP, codemode, and tool-search extensions; SDK sessions opt into their factories. Enabled MCP servers connect in the background and list metadata. “Deferred” does not mean unopened servers. Default MCP configuration exposure `codemode` maps to registry exposure `deferred`: tools stay callable, omit inline declarations, and enable the code-mode entry tool. Configuration exposure `deferred` instead enables model-side `tool_search`.

```text
MCP connection → tools/list → session-filtered registry
                                ├─ tool_search → activate declarations next turn
                                └─ codemode {code}
                                     → fresh worker + QuickJS-WASI VM
                                     → searchTools / describeTool / describeNamespace
                                     → tools.<name>(JSON args)
                                     → ctx.executeTool → runToolCall
                                     → lookup + preparation + validation + hooks
                                     → MCP call → structured result → script
                                     → emitted output / return value → model
```

In-script discovery uses local BM25 and does not activate provider declarations. Scripts run an async **JavaScript function body**, with `await` and `return`, not a TypeScript module. Generated TypeScript signatures describe APIs but neither compile code nor validate arguments. The guest has no Node process, filesystem, modules, network, or timers. Injected host tools still perform real operations outside the guest.

**Model visibility and callable scope differ.** Active `direct` tools and registered `codemode`/`deferred` tools are script-callable; `model-only` and `hidden` are not. Mode `only` suppresses direct declarations without revoking their script access. Session allowlists/denylists filter the underlying registry, so activation cannot restore an excluded tool. The codemode entry itself is model-only to prevent recursion.

Pi returns MCP scripts `{content, structuredContent?, isError?}`, removing top-level `_meta`. Structured MCP failures can resolve as inspectable data; ordinary failures reject. It persists successful `store/load` deltas along the current branch, not a VM continuation. Its integration sets a 256 MiB guest limit but defaults to `Infinity` timeout, unlike the library's five-minute default. Output truncation and bounded nested-call metadata happen after or separately from execution, not as hard live-output/call limits. ([Pi integration source](https://github.com/earendil-works/pi/tree/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/coding-agent/src))

## Use the dependency; change three Nyte owners

**Depend on `@earendil-works/pi-codemode@0.99.2`**, using its public sandbox, WASM loader, declaration renderer, identifier helpers, and dedicated `/worker` entry. Nyte supplies a `{code:string}` tool and scoped adapter, not a runtime port. No deep imports, source parser, provider grammar, or separate engine copy are needed. Set finite timeout and guest memory, forward run/lease cancellation, and close the sandbox after execution. Model-supplied timeout options must not enlarge the host ceiling.

The library has **no hard aggregate output/call limits or public emission callback**. Guest memory does not cap host allocations, and post-return truncation cannot prevent them. This is a documented limitation, not an unrequested reason to fork. If strict aggregate output/call limits are a release requirement, an upstream API contribution or narrow vendoring is justified.

For that conditional fork, the eight-file candidate set from pinned `packages/codemode/src/` is `runtime/host.ts`, `runtime/worker.ts`, `runtime/protocol.ts`, `runtime/prelude-source.ts`, `types.ts`, `wasm.ts`, `identifier.ts`, and `declarations.ts`. Preserve relative layout, depend on `quickjs-wasi@3.6.2`, add accounting before output/transfer retention, and abort outstanding callbacks on limit violations. Omit upstream `index.ts` and `source.ts` for the plain `{code:string}` entry; use Nyte build configuration and adapt copied assertions/`any` to local type rules. Do not maintain a fork alongside the dependency.

Adapt only the useful operations from Pi's `coding-agent/src/extensions/tool-search/tool.ts` for tokenization/document building/BM25, `extensions/codemode/execute.ts` for discovery, and `extensions/mcp/tools.ts` for collision-aware naming and structured-result conversion. These are integration references, not standalone exports. Do not copy their Pi session/UI imports or optional model globals.

| Nyte owner | Minimum change |
| --- | --- |
| `packages/core` | Separate eligible execution catalog from provider declarations; provide run-scoped nested lookup/invocation through preparation, validation, hooks, cancellation, and target provenance; own executor lifecycle and outer replay policy. |
| `packages/plugin` | Keep `src/mcp.ts` pooling, refresh, session enablement, and transport. Retain MCP structured data and output-schema metadata beside display content; explicitly choose structured-error behavior. Register the code-mode adapter using core's eligible view. |
| `packages/host` | Compose/configure the adapter beside existing MCP integration. |

Start with non-waiting MCP targets only. Discovery and dispatch use the same post-availability, post-agent-allowlist catalog; dispatch rechecks current eligibility. Neither raw `api.tools.list()` nor a bound tool's `execute` alone supplies the whole invocation pipeline. Hide selected MCP declarations for prompt reduction without deleting their executable definitions.

Keep `rename_chat` foreground-only, as the user reports it now is. Children must neither discover nor invoke it or question/interactive tools, including through aliases. **Children not prompting users is intentional unattended operation.** Preserve inherited workspace trust and existing plugin grants, useful MCP/search, and independent session settings. Unavailable targets return an error, not a new approval prompt. The notes inspected Nyte's working tree, including uncommitted changes, not an immutable GitHub snapshot. ([Local runner filtering](file:///Users/workgyver/Developer/nyte/packages/core/src/kernel/sdk/runner.ts#L141-L150); [local MCP bridge](file:///Users/workgyver/Developer/nyte/packages/plugin/src/mcp.ts#L356-L422))

## Keep restart behavior and packaging explicit

Mark the outer program **`replay: "never"`** initially and disable persistent script store. A failed or interrupted program can leave completed remote writes; cancellation cannot undo them. Call summaries are not durable effect outcomes. Later resumability needs persisted inner identities/intents/results plus deterministic replay or a continuation design. A `ToolWait` currently becomes a script error, not a parked VM; exclude bash/jobs/delegation/browser/question waits initially and preserve independent background-task lifetimes.

Desktop changes should be build/resource wiring only. Run in a Node-capable host, outside renderer/preload, with a dedicated worker entry statically importing `@earendil-works/pi-codemode/worker` and explicitly shipped QuickJS WASM. Supply `workerUrl` and `wasm` rather than trusting bundled sibling paths or ASAR placement. Native/Bun compilation needs its own embedded worker/resource wiring; retain shared atomic interruption. WASM is prebuilt, not a native addon needing Electron ABI rebuilds.

Retain Pi's full MIT notice, copyright **2025 Mario Zechner**, in redistribution notices. Record paths and commit provenance for any copied integration code or conditional runtime fork. Include `quickjs-wasi` notices, copyright **2026 Vercel, Inc.**, and engine notices. If MCP/OAuth code is later copied, also preserve its SDK-derived MIT notice, copyright **2024 Anthropic, PBC**. Dependency use does not remove redistribution notice obligations. ([Pi license](https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/LICENSE))

## Conclusion

Use the exact dependency plus Nyte's scoped adapter for MCP orchestration, not a preemptive executor fork or resumable general-purpose programs. Strict aggregate limits justify additional runtime work only when required for release. No application code was edited. This synthesis performed no new source or registry research, installs, builds, tests, live MCP/provider execution, security audit, or packaged Electron/Bun verification. Earlier notes inspected source and tarballs; they do not establish runtime correctness or complete license/protocol conformance.
