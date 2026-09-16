# @nyte-ai/desktop

The Electron desktop client embeds the Nyte host. Main-process code lives in `src/main`, the preload bridge in `src/preload`, and the React interface in `src/renderer`. Shared session behavior belongs in core.

## Development

From the repository root:

```sh
pnpm dev:desktop
```

Agents leave this command to the user. For checks and local packaging:

```sh
pnpm --dir packages/desktop test
pnpm --dir packages/desktop typecheck
pnpm --dir packages/desktop build
pnpm --dir packages/desktop package
```

The package command disables publishing. Platform-specific packaging scripts are listed in [package.json](package.json).

Photon is also listed as a desktop runtime dependency so Electron externalizes core's image processor instead of embedding its WASM in the main entry.

## Design scale

Colour, type, radius, shadow, and motion change with the appearance, so they live in `src/renderer/src/theme/tokens.css` behind the typed handles in `vars.stylex.ts`. Spacing and sizing do not change with the appearance: a gap is the same 6px in every theme, and wrapping that in `space.x6` would add a name without adding a decision. So the scale is enforced by `lint/design-scale.js` rather than tokenised, and its messages name the steps and the escape hatch.

A measurement that carries a decision, such as a traffic-light lane, a row height, a panel width, or a toast's close lane, is not a step. Name it in `theme/schema.stylex.ts`, back it with a `--nyte-*` custom property, and reference the token. A `defineConsts` value used as a length must be that `"var(--nyte-*)"` string and never a bare number: `defineConsts` emits no declarations and works only by inlining, so a number resolves to an undeclared variable wherever a file is transformed alone. Glyph sizes are the standing exception to the grid, not to that rule; icons and the spinner are drawn on an odd grid, so `schema.stylex.ts` names them in `glyph`.

The rules read style objects, not the rendered page. Anything the compiler resolves, anything computed, and anything passed as a prop is on the scale by convention rather than by check, so a green lint is not proof the tree is on it.

## Sidebar

Each workspace shows five chat items by default, including drafts. Lists with six or fewer items show everything without a toggle. **Show more** reveals the full filtered list; **Show less** returns it to five. Each workspace expands independently, including Home and Cloud.

## Chat Markdown

Chat uses [`@lobehub/streamdown`](https://github.com/lobehub/streamdown) with GFM tables and task lists. Active responses use its realtime streaming renderer. Saved responses use its cached whole-document renderer, so reference links and footnotes resolve across blocks. Cross-block references may remain literal during streaming until the response finishes.

Nyte keeps its own code blocks, worker-based syntax highlighting, Mermaid diagrams, and host-routed links. Raw HTML is disabled and images appear as text labels. Reduced motion displays incoming text immediately without reveal effects, including when the preference changes during a response.

## Provider sign-in

Settings › Models lists every provider with its connection state. A provider whose flow runs in the browser shows a **Sign in** button; one that takes a key shows **Add API key**. Credentials and the model catalog live in `~/.nyte`, shared with the TUI, so a sign-in made in either client counts in both.

Providers that use a device code, such as GitHub Copilot, show the code in the row while the host polls for approval, with **Copy code** and an **Open** button for the verification page. The code and any instructions the provider sends with it stay until the attempt ends; later progress messages appear under them. Copilot's instructions identify the GitHub Copilot OAuth app used by Pi, not a Nyte or OpenCode app. **Cancel** in the row stops the poll on the host side and no credential is stored. Closing the window or signing out of the provider cancels the same way; a sign-out that arrives while a credential is being saved waits for that save and then removes it.

After the credential is saved the host applies any account-specific model availability and asks the provider to refresh a dynamic model list. Static catalogs need no refresh. A connected provider only lists models permitted by the current credential; disconnected providers keep their static definitions visible in Settings for browsing. An empty account list also leaves Settings reachable for a new sign-in, without listing unavailable models. If dynamic discovery fails the row still shows the provider as connected and the toast says the model list could not be updated; sign out and in again to retry. Only web links from a provider are opened; anything else is reported in the row instead. Sign-in flows that would need a terminal prompt fail with a message to run `nyte login` instead.

The main-process side is covered by `src/main/host-login.test.ts`. `src/renderer/src/chrome/models-settings-login.electron.test.ts` drives the settings row with real clicks in Electron's Chromium over a recorded bridge; it builds the harness in `src/renderer/src/chrome/fixtures/` and needs an environment where Electron can open a window.

Read [AGENTS.md](AGENTS.md) for process boundaries, [UPDATES.md](UPDATES.md) for updates, [PERFORMANCE.md](PERFORMANCE.md) and the [benchmark guide](benchmark/README.md) for performance work, and [build/ICONS.md](build/ICONS.md) for icons.

## Testing a deployed server

Deploy the [Vercel example](../demo/server/vercel/README.md) with `NYTE_TOKEN`
and provider credentials. For an existing Nyte Codex OAuth sign-in, use the
example's `sync:codex` command, then `run deploy`. Test from this checkout:

1. Run `pnpm dev:desktop` from the repository root.
2. Open Settings › Server, enter the production domain and its `NYTE_TOKEN`, and
   click **Connect**. The desktop checks authentication before saving the
   connection in `~/.nyte/server.json`.
3. Click the new-chat button beside **Cloud** in the sidebar. Send a short
   message and confirm that an assistant response appears.
4. Open another chat, then return to the Cloud chat and confirm its response
   is still visible.

Cloud chats use the server's provider credentials and start with its
`NYTE_MODEL`. Their model picker reads the server's available models. Local
provider settings and hidden models only affect local chats. Signing into a
provider on the desktop does not configure that provider on Vercel until you
explicitly sync it.

Settings checks the saved connection when opened and every 15 seconds while
visible. **Connected** means the authenticated server info request succeeded;
it does not mean a provider request was tested. The row separately reports
workspace tools and chat-history persistence. **Check
connection** repeats the check. Access failures and unavailable deployments
offer a clear error instead of claiming the saved URL is connected.

If the server's chat list fails, Cloud keeps its last loaded chats and displays
the failure. An unavailable server does not look like an empty chat history.
Core's shared `SessionObserver` (`@nyte-ai/core/client`) handles stream
recovery for local and Cloud chats alike; the renderer's `live.ts` holds one
observer per open chat and publishes its state into the snapshot query cache
and the live overlay.

Remote model choices and defaults use the same `provider.models.list` and
`provider.models.default` SDK operations as other clients. Deployment info
contains no second model catalog.

The desktop connection tests use a real HTTP server, runner, and SQLite store
with a scripted provider. They cover token rejection, Cloud ownership,
streamed replies, saved transcript reads, provider failures, unavailable
deployments, and server-specific model choices:

```sh
pnpm --dir packages/desktop exec vitest run src/main/host-server.test.ts
```

## Mobile connection

Settings › Server has two connections that point opposite ways. **Server** is
outbound: a deployed Nyte host whose chats appear under Cloud. **Share with
iOS** is inbound: the desktop serves one of its own local stores to the Nyte
iOS app over the v1 wire, using `@nyte-ai/server` on a Node listener in the
Electron main process.

**Start sharing** serves the folder selected at that moment, Home or a trusted
project. The share is frozen to that target: switching folders on the desktop
does not move it, and the row names what is being served. A project must be
trusted first. The Cloud server is never a candidate; only local targets are
served.

The listener binds `127.0.0.1` on an ephemeral port and the row shows the
exact address. It reaches the iOS Simulator on this Mac and nothing else: no
LAN or public bind, no tunnel, no TLS. Each share generates a random 256-bit
bearer token, shown masked with **Reveal**, **Copy token**, and **Copy
address**. The token is never written to disk or logged. **Stop sharing**
closes the listener, drops its connections, and ends open watches with a
`closed` frame; starting again generates a new token and address.

The phone and the desktop read and write the same SDK and store, so root
conversations and updates match on both. Runs still execute on the desktop:
a message the phone sends attaches the session through the same per-session
attachment the desktop uses for its own sends. Stopping the share does not
abort accepted work or close the desktop SDK. Sessions the phone creates
appear in the desktop sidebar on the session directory's regular refresh.

The main-process side is covered by `src/main/host-mobile-share.test.ts`:

```sh
pnpm --dir packages/desktop exec vitest run src/main/host-mobile-share.test.ts
```

## Recorded usage

Settings › Usage answers four questions in order: what Nyte cost in the selected
range and which models spent it, how much of each subscription window is left,
where inside Nyte the spend went (folder and chat), and what every tool has
recorded all time. Dollar figures are API-rate estimates of recorded tokens, not
subscription charges.

One history read per visit answers all four ranges; switching range is arithmetic
in the renderer. Desktop and TUI use `readLocalUsage` from `@nyte-ai/host/usage`.
Desktop keeps its history scans in the existing worker and reuses persisted file
caches. The reader respects `CLAUDE_CONFIG_DIR` and `CODEX_HOME`; it needs no
credentials, no network request, and neither CLI on PATH.

Plan limits are the exception: `host.accountLimits` asks Anthropic and OpenAI for
the windows of the accounts Nyte shares with Claude Code and Codex. That request
runs once per visit, times out after ten seconds, and each provider answers for
itself, so a signed-out or slow provider leaves the other's windows on the page.

## Queued messages

A message sent with Enter while a run is live steers it: the message draws at the transcript's tail, muted until it lands at the next response boundary. Cmd/Ctrl+Enter queues a follow-up for an idle head, and the queue tray previews those pending messages above the composer. Hover or focus a row to edit it, send it now with the up arrow, or remove it with the trash button. Enter on an empty composer sends the first queued message now. Sending and error states remain visible in the row.

Queue, agent, and terminal trays share their surface, header, and list styles in `src/renderer/src/theme/tray.stylex.ts`. Their geometry and appearance come from the `--nyte-tray-*` tokens in `tokens.css`, including the same 12px radius and soft shadow in both themes. A tray takes the composer's fill and a hairline edge, so the stack above the composer reads as one surface and a hovered row is a lift inside it rather than a bar on the page. `src/renderer/src/theme/tray-surface.test.ts` checks that in a real renderer. Row height grows with message or status content.

Pinned user messages use separate `--nyte-conversation-user-*` tokens: a faint border, a stronger hover border, and a small 5% black shadow only while pinned. Their opaque fill keeps scrolling messages from showing through.

File and skill chips use the same inline styling in the composer, queue, and transcript: transparent background and no extra vertical padding or negative margins, so wrapped lines do not overlap.

## Composer and read-only messages

The composer, sent user text, and queued text share the Lexical setup and chip rendering in `composer-surface.tsx`. Sent messages convert persisted skill instructions back to the same reference nodes used while editing. Read-only messages omit editing history, completion handling, remove buttons, and the custom caret. Editing uses the same composer without a status banner; Escape or a click outside the composer cancels the edit. Composer controls and their menus or dialogs keep the edit open, and saving or attachment loading prevents dismissal. They render immediately without moving the active selection.

The behavior follows the installed Cursor reference where Nyte has the corresponding data:

| Case | Nyte behavior |
| --- | --- |
| Incomplete `/skill` text | Remains ordinary text until a skill is selected |
| Selected skill first or on its own | Keeps the `/skill-name` chip and sidebar label |
| Draft sidebar label | First visible line, updated after a 100ms debounce; empty fallback is `Draft` |
| Persisted skill instructions | Display as a chip, with instruction contents hidden |
| Read-only spacing | Collapse three or more newlines to two; remove empty edge lines while preserving inline spaces |
| Read-only chip activation | Opens its reference without also editing the message |
| Web URLs | Lexical detects URLs; HTTP and HTTPS links open through the desktop host |
| Long sent messages | Text preview collapses after 3.5 lines; attachments remain outside the text collapse |
| More than 100,000 source characters | Shows `Message is too long to display` |

Reference modules are `ComposerLexicalRenderer.js`, `ComposerRichTextInline.js`, `promptInputRichText.js`, and `draftAgentRepositoryService.js` in Cursor's workbench bundle. Cursor also contains format-specific TipTap and legacy routes, cloud worker labels, video/terminal-selection fallbacks, and tile-draft visibility rules. Nyte does not store those Cursor-specific document formats or draft kinds. They are not added to its message model. Nyte keeps its existing workspace and draft visibility rules.

Settings switches use Cursor's flat regular geometry: a 30×18px track and a 14px thumb. Menu switches share the flat finish. Keyboard focus retains its visible outline.

## Context menus

Right-click menus are native. `host.contextMenu` takes a small template from the
renderer and pops an Electron menu; each entry carries the work it performs, so
`renderer/src/components/context-menu.ts` runs the chosen one and no call site
matches choices back up. Native menus float above the `WebContentsView`s that
browser panels composite over the renderer, so they need no overlay-occlusion
registration, and clipboard items use Electron roles so a paste keeps formats a
renderer-side clipboard read cannot reach.

The file editor menu carries cut, copy, paste, and select all, then Format
Document and Save, then the path actions. The explorer serves the same menu from
a row's right-click and its menu button: Open, reveal in the system file
manager, Search Files, the path actions, and Refresh Explorer.

## Workspace search

The workbench calls `searchWorkspaceFiles` from `@nyte-ai/core/files`. Desktop does not resolve or install its own search binary. The first search downloads ripgrep if neither the system nor Nyte's cache has a compatible executable.

Regex mode uses ripgrep's default engine, not JavaScript regex. Lookaround and backreferences are unsupported. Literal search, case sensitivity, whole-word matching, and workspace-relative include/exclude filters remain available. Ignore rules still apply when an include filter matches an ignored file.

Desktop owns IPC validation, window cancellation, and error mapping. Core owns draft overrides, workspace confinement, UTF-16 selections, and the editor's UTF-8, binary, and file-size rules. Its private temporary snapshots keep search on the validated disk bytes; drafts go through stdin. Core also owns the bounded reader and version-checked saver used by editor tabs. Search no longer inherits the mention list's 5,000-entry cap. Match, byte, output, and time limits still report incomplete results explicitly.

Filename mentions use core's ripgrep discovery and fuzzy ranking. No native search binding, ASAR patch, or search-specific packaging setup is required.
