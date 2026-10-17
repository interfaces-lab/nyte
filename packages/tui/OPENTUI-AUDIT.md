# TUI audit

Audited on October 14, 2026 against [OpenTUI 0.6.5](https://github.com/anomalyco/opentui/releases/tag/v0.6.5), [OpenCode dev at 8ffbcc2](https://github.com/anomalyco/opencode/tree/8ffbcc2c81d1ff558618137204c36954797d7a6f), and the [CLIProxyAPI SDK guide](https://github.com/router-for-me/CLIProxyAPI/blob/5fc580b1d72d87a7bcfe5cfb6f479c1aea5625b3/docs/sdk-usage.md).

## Menu inventory

All menus use the slot below the composer. Only an inspector with a loaded subagent transcript may take the whole screen. Unknown tasks, loading tasks, and command output use the slot too.

| Command or primitive | Presentation and behavior |
| --- | --- |
| `/help`, Ctrl+K | Bounded command list. Keyboard shortcuts open a bounded text report. |
| `/settings` | Bounded settings list. |
| `/model` | Model list and details share the same half-terminal budget as other pickers. Detail rows collapse on short terminals. |
| `/effort`, `/theme`, `/follow-up`, `/scroll-acceleration`, `/copy-on-select`, `/auto-update` | Bounded setting-choice list. Plugin settings use the same primitive. |
| `/login` | Provider list, method choice, account name, secret or authorization code, organization choice, link/code, and waiting steps are inline. Choice lists scroll; URLs occupy one row and open/copy actions retain the complete URL. |
| `/logout` | Provider list. Failed stored credentials remain selectable. Removes the active login and preserves other saved accounts. |
| `/accounts [provider]` | Named accounts with an active marker. Selecting one changes the login used for subsequent requests. |
| `/resume`, `/sessions`, `/continue` | Bounded session list. |
| `/skills` | Bounded list or an empty-state notice. Selecting a skill fills the composer. |
| `/tree`, `/edit` | Bounded tree, with the selected entry revealed after viewport resize. Branch-summary choices use the shared list. |
| `/usage` | Content-sized, bounded account-quota and conversation-cost report. Scroll hints appear only when content overflows. |
| `/plugins` | Content-sized, bounded plugin report. |
| `/tasks` | Bounded task list. Command output is bounded inline. Opening a loaded subagent transcript is the fullscreen exception. |
| Questions | Short title, full prompt in a bounded scrollbox, then answers. Ctrl+PageUp/Down scroll the prompt independently of answer selection. |
| Queue picker | Shared bounded list. |
| `/`, `@`, `/cd` completion | Inline completion window. |
| Attachment previews | Bounded inline preview. Queue, task summary, and preview chrome yield space while a menu is open. |
| `/new`, `/cd <path>`, `/compact`, `/quit`, `/reload`, `/update` | Actions with inline feedback rather than dialogs. |
| Plugin commands | Core commands run as actions; prompt commands fill the composer. |

The shared panel title occupies one row. Full question text lives in its scrollable body, so a long question cannot push its answers or Escape hint offscreen. A regression check enumerates the actual command registry and renders every command that opens a menu.

## Keymap and OpenTUI

Core, Solid, and keymap packages resolve to 0.6.5. The app now uses OpenTUI's default keymap factory, as OpenCode does. The managed textarea layer retains native composer editing and undo. Base-layout fallback preserves physical shortcuts on non-Latin layouts. Selection, dialogs, fields, completion, and chat retain explicit priorities; components do not register raw key-input listeners.

The audit fixed text panels covering the transcript, misleading position counters, oversized model details, unbounded auth choices and question titles, hidden tree selections, and a wrong next-task hint. Escape and Ctrl+C close ordinary menus, with text-selection copying taking precedence.

Nyte deliberately keeps its current workflow keys. These differ from [OpenCode's configured defaults](https://github.com/anomalyco/opencode/blob/8ffbcc2c81d1ff558618137204c36954797d7a6f/packages/tui/src/config/keybind.ts):

| Action | Nyte | OpenCode |
| --- | --- | --- |
| Command palette | Ctrl+K | Ctrl+P |
| Cycle model | Ctrl+P / Ctrl+Shift+P | F2 / Shift+F2 |
| Cycle reasoning | Shift+Tab | Ctrl+T |
| External editor | Ctrl+G | Leader, E |
| Ctrl+Enter | Alternate message delivery | Newline |

OpenCode also offers configurable bindings and leader sequences. This change preserves Nyte's fixed command registry rather than adding a second configuration system. Native resources already use the renderer's native scene, and computed geometry uses `getComputedLayout()` rather than the removed Yoga-node API.

## Accounts and usage

Caller API:

```ts
const accounts = await connection.models.accounts("openai-codex");
const work = accounts.find((account) => account.label === "Work");

if (work) await connection.models.selectAccount(work.provider, work.id);

const usage = await connection.models.usage();
```

Account enumeration, selection, and usage require owner authority. Credentials never appear in these views. Each provider stores one atomic collection of named accounts and its selected account ID. Login adds an account; logout removes the active account. Existing single credentials migrate at the storage boundary to a `Default` account. File locking and encrypted host storage retain their existing ownership boundaries.

Request authentication captures an account before refreshing its token. Refresh updates that account even if selection changes while the request runs. Compare-and-swap retries reuse an already completed token exchange when only account selection changed.

The provider-scoped collection was chosen over separate account and selection records because existing stores already serialize provider mutations. Separate records would require additional multi-record transactions without changing the caller's operation.

`/usage` runs one addressed load effect. Rendering reads the resulting state. The AI layer owns account-scoped quota caching:

- Successful endpoint reads stay fresh for 60 seconds.
- Concurrent readers share one request, including authentication.
- Failures wait 15 seconds before retrying; previous readings remain visible and marked stale.
- A caller's cancellation does not cancel other readers.
- Login, logout, and selection changes invalidate pending quota work. Old responses cannot populate the new account's reading.
- Partial response telemetry merges by window identity and observation order, preserving scoped windows and newer values.
- Unsupported providers skip authentication and network work. Account metadata is enumerated once before and once after a batch.

Anthropic OAuth uses its existing `/api/oauth/usage` adapter. Codex uses its existing `/wham/usage` adapter. Neither requires loading a model catalog or generating a response. Providers without a verified quota adapter can still expose response telemetry. Conversation token/cost totals and the host's local-history scanner remain separate from subscription quotas.

[OpenCode's credential service](https://github.com/anomalyco/opencode/blob/8ffbcc2c81d1ff558618137204c36954797d7a6f/packages/core/src/credential.ts) informed stable account identity and explicit activation. CLIProxyAPI's guide describes embedding and account-aware routing; it does not specify this TTL policy. The cache and retry policy above are Nyte's implementation decisions.

## Input behavior

Typed dialog fields support Ctrl+A and Cmd+A selection, shifted movement, deleting a selection, and replacement by typing or paste. Cmd+Backspace deletes to the start of the field, clearing a just-pasted key. Long values keep the caret visible. API-key fields render masks throughout. Clipboard text is addressed to the dialog and auth-prompt generation that requested it; a late read cannot paste into a later login step or the composer. Blank API keys are rejected before account persistence.

Tree filtering moves its all-entries shortcut to Ctrl+Shift+A so Ctrl+A remains available for editing its query. OAuth callback/state/PKCE behavior and token refresh are exercised by the provider fixtures; browser authorization still uses the provider's normal flow.

## Verification

The compiled-binary PTY scenario covers inline menus, usage before and after a response, account selection, the credential used by the next request, persistence across restart, and login-field paste/select/delete/replacement, including Cmd+Backspace. It also cancels an unfinished login before quitting, guarding against an input wait that previously kept shutdown pending. Unit and rendered-screen checks cover bounded long prompts, large auth lists, masked fields, account migration, refresh pinning, cache concurrency, expiry, failure backoff, and stale-response rejection.

The emulated PTY verifies terminal protocol behavior. OS clipboard integration and a live provider browser login are outside that fixture.

Final checks passed: 453 regular TUI tests across 40 files, TUI typecheck, the binary build, and both compiled-binary QA scenarios, with 7 headless and 22 PTY steps. The host-platform target bundle passed; five other platform bundles were skipped because their native libraries are not installed on this machine. Formatting passed across the changed TypeScript files.

The broader verification also found existing failures outside this change: core part-closing, plugin-ID, and workspace expectations; the SDK queued-edit sequence expectation; host's `claude-sdk` provider-list expectation and plugin watcher timeout; and Vercel's conflicting Nitro versions. Those files' unrelated behavior was left alone. The package-wide TUI lint includes existing errors in the untracked temporary probes under `test/tmp` and `probe-hang.tmp.ts`.
