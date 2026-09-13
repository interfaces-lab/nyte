# @nyte-ai/ios

Nyte's native iOS companion. The Mac host owns conversations, model credentials,
and tool execution. This package uses `@nyte-ai/client` for HTTP/SSE and the
Node-free `@nyte-ai/core/client` `SessionObserver` for transcript state and recovery.

The app supports a saved host connection, chat status, streamed replies,
follow-up messages while a run works, a separate Stop action, answers to waiting
selections, and host-backed model selection. Changed-file review shows run
evidence and lets you inspect the current workspace diff. Opening review preserves the composer and selection
drafts. Returning from background refreshes the list and rechecks the host.
Failed sends retain the draft and retry key while that conversation remains open.
Each completed message and expanded disclosure has a copy button that
copies its Markdown source. Photo library selection and
VisionCamera capture stage up to three JPEGs locally; only Send transmits them.
A durable offline outbox, QR pairing, and relay discovery are not implemented.

## Connecting

Nyte desktop exposes the connection under Settings › Server › iOS Simulator. Starting it binds the server to `127.0.0.1` on an ephemeral port
with a random token and offers Copy address and Copy token. The app's connect
screen takes a name, that address, and that token, then verifies `/v1/info`
before saving. Verification gives up after ten seconds and can be cancelled, so
a wrong address does not hold the form.

Because the server listens on loopback, only the iOS Simulator on the same Mac
can reach it. A physical iPhone, a relay, or remote access is not supported yet.
Plain HTTP is accepted only for loopback and private IPv4 addresses, checked
numerically; anything else must be HTTPS. The token is stored in the iOS
Keychain and masked in the form by default. Autofill is disabled in the input
configuration, but iOS may still offer to save it in Passwords. No
provider credentials or deployment secrets belong in the bundle.

## Development

Verified with Expo SDK 57 and Xcode 27 beta's iOS 27 SDK. Select the beta
for the current terminal without changing the system Xcode setting:

```sh
export DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer
```

From the repository root:

```sh
pnpm install
pnpm --dir packages/ios prebuild
cd packages/ios/ios
pod install
```

From the repository root, start Metro yourself, then build and launch in
another terminal with the same `DEVELOPER_DIR`:

```sh
pnpm --dir packages/ios dev
pnpm --dir packages/ios ios
```

The local scene lifecycle config plugin supplies the single-window scene delegate required by the iOS 27 SDK. Expo 57 still generates the older app lifecycle, as tracked in [Expo issue 46664](https://github.com/expo/expo/issues/46664). Remove the plugin and its Swift adapter once a stable Expo prebuild template includes `ExpoAppSceneDelegate`. The adapter keeps window creation in the scene and forwards lifecycle and link events through Expo.

Native Markdown and SF Symbols require a development build; Expo Go cannot
load them. The native Xcode project is generated from `app.json` and ignored by
Git. Change app config rather than editing generated native files. Real-device
signing requires your own Apple team.

`ios:release` builds and launches a Release app without Metro. `ios:build`
does the same without installing Pods and copies the built `.app` into
`packages/ios/build/app`; `bundle` writes the Hermes bundle to
`packages/ios/build/export`. The `build/` directory is ignored by Git, as are
`ios/` and `dist/`. Xcode's own DerivedData stays in its default location.

If CocoaPods selects an SDK from mismatched Command Line Tools, explicitly
use the SDK from the selected Xcode:

```sh
SDKROOT="$(xcrun --sdk macosx --show-sdk-path)" pod install
```

## Source layout

Start in `src/app.tsx` for startup, providers, and connection restoration. Follow
`chat/chats-screen.tsx` into the conversation list and navigation, then
`chat/chat-screen.tsx` for transcript layout and keyboard following.

| Location | Owns |
| --- | --- |
| `src/connection/` | Connection form, address validation, Keychain, and host client creation |
| `src/chat/` | Conversation screens, composer, message rendering, selections, models, and remote session state |
| `src/media/` | Photo picking, local image preparation, and camera capture |
| `src/ui/` | Shared native glass buttons and empty states |
| `src/theme.ts` | Shared colors, typography, spacing, and control dimensions |
| `plugins/` | Source-controlled Expo native configuration |
| `test/` | Behavior checks without native modules |

`chat/composer.tsx` owns drafts, attachment staging, and Send/Stop controls.
`chat/messages.tsx` owns message and Markdown rendering. Keep a feature's state
and components together; add a shared UI component only when several features
use it. Protocol types and execution rules stay in their existing workspace
packages. Imports point directly to the owning file; there are no barrels.

[Bluesky's source organization](https://github.com/bluesky-social/social-app/tree/main/src)
was reviewed as a reference for separating app startup, screens, and feature
components. Nyte uses smaller feature folders suited to this companion app;
no Bluesky implementation or styling was copied.

## Checks

```sh
pnpm --dir packages/ios typecheck
pnpm --dir packages/ios test
pnpm --dir packages/ios bundle
```

`test` covers address validation and host error wording without native
modules. `bundle` builds a production Hermes bundle for iOS without starting a
dev server. TypeScript follows the repository version; Expo's dependency check
excludes only that compiler while enforcing its React and native library
versions.

## UI and reference

The interface follows the chat and keyboard behavior demonstrated by
[Margelo's AI chat demo](https://github.com/margelo/ai-chat-demo), reviewed at
`6280b1f0f6d53d557b160481185e7bdfa7385cb6`. That repository has no license file;
this app independently implements its patterns using published libraries.

The Chats list uses one text rail and a fixed footer above the safe area.
Refresh stays outside the scroller; Disconnect is an explicit destructive action beside the
host details, with a confirmation before removing the saved token. Empty screens share one title/body scale and short, specific copy.

Expo UI's SwiftUI `Button` supplies native `glass` and `glassProminent` controls
on supported iOS versions, including iOS 27. `GlassButton` is the single native
control boundary: its `Host` handles SwiftUI sizing, while React Native owns the
safe area and keyboard insets. SwiftUI owns the glass material and accessibility
behavior. Nyte's accent token colors primary actions; neutral controls use the
foreground token. Message content stays on solid surfaces.

React Strict DOM supplies the StyleX-compatible `css` API for native layout,
with no WebView bridge. All screens consume colors, typography, spacing, radii,
and control metrics from `src/theme.ts`. Colors are generated from the canonical
`packages/ui/src/platform-tokens.stylex.ts` through `@nyte-ai/ui/platform-colors`;
`pnpm --dir packages/ui check:tokens` rejects stale CSS or native color output.
Native type sizes and touch targets stay in the iOS theme rather than inheriting
desktop density.

Legend List owns message virtualization and sent-message anchoring. Keyboard
Controller coordinates the composer and list insets. Enriched Markdown renders
replies natively and respects iOS Reduce Motion. Expo supplies the native build,
streaming fetch, and Keychain integration.

## Package choices

| Package | Responsibility |
| --- | --- |
| `expo` 57, React 19.2, React Native 0.86 | Native build and app runtime |
| `@expo/ui` 57 / `swift-ui` | Native glass controls and menus |
| `react-strict-dom` | StyleX-compatible native content layout |
| `@nyte-ai/ui/platform-colors` | Generated shared Nyte colors |
| `@nyte-ai/client`, `@nyte-ai/protocol` | Typed HTTP/SSE transport, boundary parsing, selection validation |
| `@nyte-ai/core/client` | Session observer, transcript projection, shared execution status |
| `@legendapp/list` | Virtualized chat and sent-message anchoring |
| `react-native-keyboard-controller` | Native keyboard coordination |
| `react-native-enriched-markdown` | Native Markdown, code, lists, and tables |
| `expo-symbols`, `expo-clipboard` | SF Symbols and local message copying |
| `react-native-vision-camera` 5.2 | Native still-photo capture |
| `react-native-nitro-modules`, `react-native-nitro-image` | VisionCamera's required native runtime and image peers |
| `expo-image-picker`, `expo-image-manipulator` | System photo selection and local JPEG resizing |
| `expo-secure-store`, `expo-crypto` | Saved host token and message retry IDs |
| `react-native-safe-area-context` | Device and modal insets |
| `react-native-reanimated`, `react-native-worklets` | Required native keyboard/list peers |
| `typebox` | Parse the saved connection at its boundary |

React DOM remains a peer of React Strict DOM. `expo-dev-client` supports local
native development. Metro uses `expo/metro-config` with Reanimated's supported
wrapper for clearer error stacks; it is not a runtime speed optimization. Expo's
preset already installs the Worklets transform, and Reanimated 4.5 enables its
React-commit-only hook optimization by default. The unused direct
`@react-native/metro-config` dependency was removed. Review and selection use
existing native lists and protocol APIs, without another navigation, state, or
diff-rendering package.

The demo's provider connections, RAG tools, embedded keys, patches, and fake
history are not part of this app. Model work stays on the Nyte host.

T3's [composer layout](https://github.com/pingdotgg/t3code/blob/68c2277f500bbbb299396bcdcd0aec60dcb5db9d/apps/web/src/components/chat/ChatComposer.tsx#L5925)
informs the shared 768pt maximum chat/composer width, compact mobile gutters,
and model control below the text input. Its mobile
[thread feed](https://github.com/pingdotgg/t3code/blob/0c5771d60a8ef2db34dfbbc142f7524badc829e0/apps/mobile/src/features/threads/ThreadFeed.tsx)
informs `chat/conversation-layout.ts`: the screen measures the list viewport
once, centers one content column inside the horizontal safe area, and hands
rows explicit widths. Native Markdown and the 85% user bubble wrap against
those numbers instead of inherited percentages. React Strict DOM sizes boxes as
`content-box`, so rows never combine `width: 100%` with padding. Message rows
are plain views with a small copy button in their meta line; wrapping them in
a SwiftUI host measured text without a width bound. Software Mansion's
[native Markdown](https://github.com/software-mansion/enriched-markdown) and
[Reanimated guidance](https://docs.swmansion.com/react-native-reanimated/docs/guides/performance/)
inform native text rendering and keyboard coordination. The camera follows
[Margelo's current skills](https://github.com/margelo/react-native-skills/tree/main/skills)
and VisionCamera v5 API; it does not use deprecated v4 camera methods.
The [morphing menu reference](https://github.com/rit3zh/expo-morphing-menu)
informs menu expectations; system SwiftUI menus provide those actions here.

## Runtime ownership and remaining work

Provider execution and storage stay on the host. Follow-ups call `messages.send`
while Stop remains available. Selections use core's `waitingCall(state)` projection,
protocol validation, and `runs.reply` with the exact wait identity. Core returns
the reply outcome; the app never fabricates one from its local clock. Desktop
and iOS use the same `sessionMark` projection for execution status.

`SessionObserver` owns bootstrap, watch recovery, and metadata refreshes. iOS
subscribes to updates and closes observation in the background. Model choices
refresh metadata; answering a selection refreshes the snapshot so parked calls
remain ordered by core.

The model picker calls `provider.models.list()`; the Mac
filters credentials, account restrictions, and its hidden/disabled model
preferences. An empty host catalog clears the displayed list. Choosing a model
queues `sessions.configure`; it does not replace the active run's frozen config.
Both apps must run the same protocol revision.

Photos are decoded sequentially, resized and re-encoded locally as JPEGs. The
app retains normalized bytes across failed sends and preserves the message's
retry key while the content is unchanged. Valid photos remain staged if another selection fails. Send errors stay beside
the composer, and question errors stay in their question card. Each image is capped at 230KiB of
base64 data to leave room in the host's default request budget. The host still
owns its configurable request limit. Camera access is requested when opening
the camera; no microphone or frame processor is used. The camera session is
released on dismissal and pauses when backgrounded. Simulator has no camera;
use its photo library to test attachment staging and sending.

`runs.changes` returns file summaries. `workspace.vcs.diff` returns the current
working-tree diff and is labeled that way, since it can contain other edits.
Missing diffs are shown explicitly; this is not run-isolated patch storage.

The [Cursor iOS study](../../output/cursor-ios-study/cursor-ios-study.html) informs
the interaction order and visual hierarchy. Durable drafts across navigation to
the conversation list, offline history, and real-phone pairing remain future work.
