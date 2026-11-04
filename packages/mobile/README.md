# @nyte-ai/ios

Nyte's iOS app. It controls a running Nyte host, either the desktop app or `nyte` on
another computer linked with `nyte account`. The host owns sessions, folders, model
credentials, and tool execution, and keeps working after the app closes.

The [remote access guide](../docs/content/docs/remote-access.mdx) has the steps for
users. This README covers how the app works, how to build it, and how to publish it.

## Quick start

You need Xcode 27 with the iOS 27 SDK. Expo Go can't run this app. Select Xcode for
the current terminal without changing the system setting:

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
```

From the repository root, generate the native project and install Pods:

```sh
pnpm install
pnpm --dir packages/mobile prebuild:dev --clean
pod install --project-directory=packages/mobile/ios
```

Start Metro in one terminal, then build and launch from another terminal with the
same `DEVELOPER_DIR`:

```sh
pnpm --dir packages/mobile dev
pnpm --dir packages/mobile ios
```

Connect a host from the welcome screen. For a connected iPhone, see
[Local builds](#local-builds).

## What it does

- The Inbox is one sectioned list with Needs input, Failed, Working, Pinned, Today,
  and Earlier, plus search and filters. The composer at the bottom starts a new chat.
- In a conversation, replies stream in order. Tool and reasoning activity sits in
  compact rows that open native detail sheets. Stop has its own control and never
  replaces Send or the microphone.
- Long-press a message to copy it. While a message still waits to run, the same
  sheet offers Edit and Remove, and Send Now for a queued message.
- While a response runs, the composer offers Steer current response or Queue after
  response. These are the host's `steer` and `queue` deliveries. A queued message
  shows as Queued until the host starts it.
- The app stores text drafts in MMKV, keyed by host, account owner, and session.
- In the composer, Return inserts a newline. The model and thinking controls stay
  visible above the input. The mic dictates on device. Type `@` to pick a file from
  the folder, or `/` to pick a command or skill. A file becomes `@<path> ` and a
  command becomes `/name `. A skill puts `Use the <name> skill.` at the head of the
  draft, the same text the desktop composer writes. In a session, a draft that holds
  only a command line runs that command on the host.
- You can attach up to three photos from the camera or a library grid. Markup bakes
  numbered points and drawn marks into a staged photo, and its comments travel as
  text beside it. Nothing uploads until you tap Send.
- The review page shows status, change totals, and the agent summary. Ask to Merge
  sends a merge instruction to the host agent. There is no merge, pull request, or
  deploy API. Changed Files switches between Agent edits, On Mac, and Uncommitted.
  Long patches show their first 400 lines until you ask for the rest.
- A canvas from a session opens on its own screen in a web view.
- Working and waiting sessions mirror to a Lock Screen Live Activity and the Dynamic
  Island.
- Settings holds appearance, message font, inbox display, the connection, the host's
  workspaces, and Disconnect.

The app never reports a send as done before the host accepts it.

## Connecting a host

| Path | How it connects |
| --- | --- |
| Nyte account | Sign in with the account the host is linked to and pick the computer. The phone enrolls itself while the host has sharing on. The host has no approval step. |
| Tailscale | Tap Connect with Tailscale, then enter the host's `https://<name>.ts.net` address and token, or tap Scan QR code. |
| Address or QR code | The same form for any other HTTPS address. A development `http://127.0.0.1` address reaches only the iOS Simulator on the same Mac. |

The welcome screen offers all three. A build without account configuration shows
Sign in to Nyte disabled, with "Account sign-in is unavailable in this build.", and
never loads Clerk.

The connect form checks the host before it saves anything. You can cancel each
attempt. When the app resumes a saved host that doesn't answer within ten seconds,
it reports No answer. Each failure says what happened and what to do next, and keeps
a refused token, a silent host, and a server that isn't Nyte apart. Retry appears
only where the same details could still work. To change the wording, edit
[`src/connection/connect-copy.ts`](src/connection/connect-copy.ts).

A pairing code is `nyte://connect?name=…&url=…&token=…`. A scanned address goes
through the same `parseConnection` policy as a typed one. The scan button appears
only on a device with a camera.

### Address policy

Every address must be HTTPS. For development and the Simulator, plain HTTP is allowed
only to the loopback addresses `localhost`, `127.0.0.0/8`, and `[::1]`. The app
refuses LAN, `.local`, and Tailscale addresses over plain HTTP. Nyte offers HTTPS for
all of them through `tailscale serve`, Cloudflare, or the account relay.

`parseConnection` enforces this, and App Transport Security backs it up. Only the
development variant sets `NSAllowsArbitraryLoads` in `app.config.ts`, so preview and
production builds refuse plain HTTP natively.

The app stores the token in the Keychain and masks it in the form. Autofill is off,
but iOS may still offer to save it in Passwords. Never put provider credentials or
deployment secrets in the bundle.

### Host identity

When the app connects, the SDK reports the host's id. The app pins the first id it
sees for each route in the Keychain. A route is a typed or scanned address, or an
account's broker origin, owner, and environment. Once a route has a pin, the app
refuses a host with a different id as Different host until you tap Pair as New Host.
Pins outlive disconnects and sign-outs.

The app checks the pin when it connects from the form, when it adopts an account
connection, and when it resumes a saved connection.

### Folders

The folder menu lists the host's available workspaces. The choice belongs to this
phone and host. The app has no screen for adding folders.

The first message in a new chat starts the session on the host. Before it sends, the
app writes the whole start to MMKV, with the request id, folder, name, model,
thinking level, and message. A retry or a relaunch sends that record unchanged.
Changing the folder afterwards sends nothing, and the waiting start keeps its
original folder. The app refuses a second start until you open or edit the waiting
one, so one message can't create two chats.

## Nyte account

Account sign-in needs two public values, inlined at build time:

| Variable | Default | What it does |
| --- | --- | --- |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | unset | Clerk publishable key. It must encode a bare Frontend API host. |
| `EXPO_PUBLIC_NYTE_CONNECT_ORIGIN` | unset | Broker and relay origin, a canonical `https://host[:port]`. |

[`src/account/account-config.ts`](src/account/account-config.ts) turns the account
off unless both parse. Local Expo commands read them from `packages/mobile/.env.local`,
which Git ignores. EAS builds read the project's environment variables on expo.dev
instead. Set both as plain-text project variables for `development`, `preview`, and
`production`. `eas.json` selects the matching environment for each build profile, and
EAS Update takes `--environment development|preview|production`. Use the same Clerk
instance as the broker and desktop. The [connect broker README](../connect-broker/README.md)
has the deployed origin.

The phone reaches every account host through the broker's relay at
`<origin>/r/<environment id>`. The host holds an outbound connection to the relay, so
it needs no inbound port, DNS name, or tunnel. The phone builds that address from the
origin and the picked environment's id. No broker answer names an address. The phone
sends no cookies on any account request.

The account flow is one panel, [`src/account/connect-panel.tsx`](src/account/connect-panel.tsx).
The welcome screen shows it inline. Once you're connected, the account button in the
Inbox header opens it in a native page sheet. The sheet shows the connected computer,
the account, and your other computers.

Sign-in opens Clerk's hosted page in an ephemeral `ASWebAuthenticationSession`,
started with `useHostedAuth().startHostedAuth({ mode: "sign-in" })`. Safari keeps no
portal session that could sign the previous account back in. Clerk's client token
lives in the Keychain through `@clerk/expo/token-cache`. Each broker call gets a fresh
standard session JWT from `getToken({ skipCache: true })`, with no template. The
Clerk instance must add an `aud` claim equal to the broker origin, and the broker
checks it. If Clerk refuses the app's bundle with `resource_missmatch`, the panel
shows Sign-in unavailable and points to Tailscale or a QR code.

### Enrollment

1. The phone draws 32 bytes from `getRandomBytesAsync`, never the synchronous call
   that can fall back to `Math.random`. It encodes them as the device bearer and
   hashes that text with SHA-256.
2. `POST /v1/environments/:id/devices` carries only `clientId`, `clientName`, the
   digest, and `role: "controller"`. The broker has the host record the device
   before it answers.
3. The answer must name the picked environment. The phone refuses anything else
   before the bearer goes anywhere.
4. The phone calls the host through the relay with the new bearer. The host can
   refuse a just-enrolled device while its lease catches up, so the phone retries
   with the same bearer every second for ten seconds, the `READINESS` window from
   `@nyte-ai/connect/enrollment`. Nothing enrolls again.
5. The host must match the id pinned for that environment, as in
   [Host identity](#host-identity).
6. The phone writes the connection, with broker origin, environment, device, and
   owner, to the Keychain. Any account change aborts the write.

`clientId` is per install and per account. Reconnecting replaces this phone's
earlier device, and two accounts on one phone get different ids.

Only the saved connection holds the bearer. It never goes in the query cache, a URL,
or a log. [`src/connection/connection-store.ts`](src/connection/connection-store.ts)
runs saves and removals in one queue, so a save that started before a sign-out
can't land after it. An abort during the write restores the previous connection. If
that undo fails too, the store serves nothing and reports the failure.

Restoring an account connection holds it to the enrollment policy. The broker must be
this build's broker, and the address must be exactly its relay for the saved
environment, with no other path, query, or fragment. A build pointed at another
broker refuses the saved connection and asks for the computer again. There is no
migration between brokers.

The device bearer outlives the Clerk session. A saved host keeps working after the
session expires or the phone goes offline. Only the list of your computers needs a
sign-in. A host that refuses the bearer shows Not accepted in Settings with
Reconnect, which opens the panel to pick it again. The app never re-enrolls on its
own, because a revoked device must stay revoked.

Each owner change aborts the previous owner's enrollment, Keychain write, and
computer list. That covers sign-in, Switch Account, and a session Clerk restores at
launch. The connection gate never serves another owner's host once Clerk names a
different owner. A Clerk session that expires keeps the saved host. Sign Out removes
it, as described below.

### Release and revoke

A release is `DELETE <relay address>/_nyte/connect/device` with the device's own
bearer. The host refuses the bearer at once and queues the broker's release, which
frees the device's slot and leaves Clerk sessions alone. A 204 means released. A 401
or 403 means the relay or host already refuses the bearer, which counts the same. No
other answer counts, including the relay's 503 for a host that isn't connected. The
phone releases:

- a bearer it doesn't keep, after a cancelled connect, an account change during one,
  an expired readiness window, a failed identity check, or a failed save
- the host a save replaced
- the saved host on Disconnect, which keeps the Nyte sign-in
- another account's host when a different owner signs in

Sign Out revokes instead. It calls the broker's `revokeDevice` first, which also ends
the Clerk session that enrolled the device, then tries the release on the host. Each
step has five seconds. The app then deletes the connection and client id and signs
Clerk out. The toast says only what answered. It reports one of these:

- the host removed this iPhone
- the host stops accepting it within a minute, when its lease runs out
- neither answered, and you should remove it on the host

### Clerk native setup

The `@clerk/expo` config plugin runs with `appleSignIn: false`, so the build adds no
Sign in with Apple entitlement.

Hosted auth returns to `<bundle identifier>://callback`, which
`ASWebAuthenticationSession` catches without an Info.plist URL type. Allow each
variant's callback under Native applications in the Clerk dashboard:

- `dev.nyte.ios://callback`
- `dev.nyte.ios.preview://callback`
- `dev.nyte.ios.dev://callback`

## Builds and variants

`app.json` holds what every build shares. [`app.config.ts`](app.config.ts) layers
three variants on top, chosen by `APP_VARIANT`:

| `APP_VARIANT` | Name | Bundle identifier | Scheme | APNs | Runtime version |
| --- | --- | --- | --- | --- | --- |
| `development` | Nyte Dev | `dev.nyte.ios.dev` | `nyte-dev` | `development` | `appVersion` |
| `preview` | Nyte Preview | `dev.nyte.ios.preview` | `nyte-preview` | `production` | `fingerprint` |
| unset or `production` | Nyte | `dev.nyte.ios` | `nyte` | `production` | `fingerprint` |

The identifiers differ so the three install side by side. An unset variant resolves
to production, so a release can't get it wrong by omission. Each variant's Live
Activity app group is `group.<bundle identifier>`, so one variant can't read
another's activity state. The Live Activity opens the variant's own scheme.

The fingerprint policy hashes native dependencies, config plugins, and patches, so an
update reaches only a binary that can run it. A JavaScript-only diff doesn't prove
native compatibility. A new native module, such as the photo access module, needs a
new binary, and an over-the-air update can't add it. Development keeps `appVersion`,
because a dev client loads local bundles anyway.

Inspect a resolved config before you build:

```sh
APP_VARIANT=preview pnpm --dir packages/mobile exec expo config --json
```

EAS profiles live in [`eas.json`](eas.json). Each sets `APP_VARIANT`, its EAS
environment, and the update channel of the same name:

```sh
pnpm --dir packages/mobile build:dev         # simulator dev client, internal
pnpm --dir packages/mobile build:preview     # internal distribution
pnpm --dir packages/mobile build:production  # App Store and TestFlight, build number auto-increments
pnpm --dir packages/mobile submit            # upload the production build
```

The EAS project is `@nameisdaniel/nyte-ios`, id `5f78a9e7-057f-490e-ae2a-1dcdb12827d9`,
stored in `app.json` under `extra.eas.projectId`. Updates come from
`https://u.expo.dev/<project id>`. `eas.json` sets `appVersionSource: "remote"`, so
EAS keeps the build number. `submit` targets App Store Connect app `6813219821`.
Submission only uploads a build. TestFlight, App Review, and release are separate
steps in App Store Connect.

`eas init` writes the whole resolved config back to `app.json`. That includes the
Live Activity extension Voltra generated for whichever variant resolved at the time.
Voltra appends rather than replaces, so `app.config.ts` drops the generated
`extra.eas.build` block before the plugin runs again. Otherwise a non-production
build would get a second extension holding the production bundle identifier.

The repository's release workflow has no iOS job, so a release tag doesn't build or
submit the app. Run the commands above to build and submit.

### APNs environment

`@use-voltra/ios-client` writes `aps-environment: development` whenever its push
support is on. Device tokens are scoped to that environment, and the other
environment rejects them with no error the app can see. A TestFlight build carrying
the sandbox entitlement would never receive pushes.
[`plugins/with-aps-environment.cjs`](plugins/with-aps-environment.cjs) runs after it
and writes the value the variant needs. Keep it last in the plugin list.

Push is enabled only at the entitlement level. Nothing sends Live Activity pushes.
`useWorkLiveActivitySync` drives `start`, `update`, and `end` from the app, so the
Lock Screen activity stops updating once iOS suspends the app. Moving updates to
APNs needs a sender with an Apple push key, and that sender belongs on the host.

## Source layout

Start in `src/app/_layout.tsx` for startup, providers, the connection gate, and the
root stack. `index` is the Inbox. `settings`, `chat/[id]`, `changes/[id]`,
`review/[id]`, and `canvas/[id]` are pushed screens, and `annotate` is a full-screen
modal. There is no tab bar. Route files only parse params and render the owning
feature's screen.

| Location | Owns |
| --- | --- |
| `src/app/` | Expo Router routes, the root layout, and thin route files |
| `src/account/` | Nyte account configuration, Clerk provider, connect panel, enrollment, release, revocation, and their wording |
| `src/connection/` | Welcome screen, connect form, pairing scanner, address policy, host pins, saved-connection store, request journal, live host stores, and the gate's host context |
| `src/chat/` | Conversation, transcript projection, composer, drafts, dictation, completions, model and thinking controls, attachment menu, folder menu and starts, sessions, canvases, and changed files |
| `src/inbox/` | The Inbox sections, filters, and account button |
| `src/activity/` | The Voltra Live Activity, synced from working and waiting sessions |
| `src/review/` | Review page with status, change totals, and Ask to Merge |
| `src/settings/` | Settings page and the device's display preferences |
| `src/annotate/` | Photo markup with numbered points, drawn marks, and comments |
| `src/media/` | Photo picking, recent photos, local JPEG preparation, annotation notes, and the attachment thumbnail |
| `src/development/` | Developer menu shortcuts |
| `src/ui/` | Shared glass buttons, groups, chips, toasts, skeletons, and empty states |
| `src/theme.ts` | Light and dark tokens for native and React Strict DOM |
| `modules/nyte-photo-access/` | Local Expo module for the limited-library picker |
| `plugins/` | Source-controlled Expo native configuration |
| `scripts/` | Completion icon sync |
| `test/` | Behavior checks without native modules |

The main transcript and composer files:

| File | Owns |
| --- | --- |
| `src/chat/transcript-rows.ts` | Ordered transcript rows from the head's view. A message keeps its row object while the message is unchanged. |
| `src/chat/messages.tsx` | Message bubbles, delivery labels, and the message action sheet |
| `src/chat/tool-activity-sheet.tsx` | Tool and reasoning detail sheets |
| `src/chat/markdown.tsx` | Native Markdown sized to its container |
| `src/chat/composer.tsx` | Draft, delivery, input, attachments, model, and thinking |
| `src/chat/drafts.ts` | Text draft storage |
| `src/chat/remote-chat.ts` | Sending, steering, withdrawing, stopping, and model changes for one session |
| `src/chat/message-scroller.tsx` | Keyboard coordination and anchoring on the exact sent message |
| `src/chat/workspace-start.ts` | Folder choice and the durable start record |

`src/settings/preferences.ts` keeps this phone's display settings in one MMKV
instance. They describe the phone, not the host, so they never travel over the wire.
MMKV reads synchronously, so the first paint has the stored value. Each setting is
one list of value-and-label choices whose first entry is the default. Appearance
stores the argument `Appearance.setColorScheme` takes, including `unspecified` for
the system setting.

Keep a feature's state and components together. Add a shared UI component only when
several features use it. Imports point at the owning file, and there are no barrels.

## How it talks to the host

Provider execution and storage stay on the host. The app reads the host through
`@nyte-ai/sdk`. Requests go over the SDK's HTTP connection. One live host connection
per host, opened with `openHost` over React Native's WebSocket, holds every live
store:

- a chat's [head](../../docs/glossary.md) store, drawn through `headView` with
  streamed text and unsent sends laid over it
- the session list store

The screens that read a store share it. The SDK reconnects and resumes the stores on
its own. The app shows the connection's health and a stale store's "Updated" time as
separate states.

Each send goes to the SDK's request journal, which the app stores in MMKV per route.
The journal holds the message until the host answers and retries it while the host
is unreachable. The transcript shows the message from the moment the journal holds
it, labelled Sending, Retrying, Queued, or Adding to this response.

Session status and tool titles come from `@nyte-ai/plugin/client/presentation`, so
the app draws what the host already decided instead of deriving it again. The model
menu lists what `models.list()` returns. Choosing a model or thinking level calls
`configure` on the session's head.

The app resizes each photo and re-encodes it as a JPEG of at most 230 KiB of base64,
which fits the host's default request budget. A photo that stays too large after the
smallest size is refused with a message. The app asks for camera access when you open
the camera. The Simulator has no camera, so test attachments with its photo library.
Dictation uses `expo-speech-recognition` and stops when the composer's screen loses
focus.

### Known gaps

- The Inbox mounts every loaded session in one `ScrollView`.
- Photo drafts live only in the mounted composer.
- Nothing sends Live Activity pushes. See [APNs environment](#apns-environment).

## Design

The interface reads like a messaging app. It has a light gray inbox with white
status cards and inset separators, blue outgoing and gray incoming bubbles with
larger message text, and compact activity summaries that open native sheets.

- Header actions use one native glass button, with no second ring around an icon or
  profile photo. Page and action icons use the shared 22pt size. Settings and profile
  row icons stay bare in a 28pt column, with 44pt touch targets. Selected cards use a
  border, not a checkmark.
- Shared content buttons use SwiftUI for full-width, labeled, and icon actions. Their
  semantic text styles grow with Dynamic Type. Busy actions are disabled for touch
  and VoiceOver. Native navigation owns title sizing and reports the header height
  that insets the transcript. Model and account sheets allow swipe dismissal, and the
  model picker reads its own sheet's safe area.
- The composer is one elevated glass capsule over a transparent dock, built on
  `expo-glass-effect`, which wraps Apple's `UIGlassEffect`. The native input grows to
  six lines before it scrolls and follows Dynamic Type. Attachment, send, and mic
  controls stay at the capsule edges. The model and thinking level stay visible above
  it, with delivery controls during a response. The input and the glass follow the
  app's light or dark appearance.
- Thinking levels use a native inline picker in a menu, limited to the selected
  model's supported levels. The searchable model sheet stays separate.
- The attachment menu ports [expo-morphing-menu](https://github.com/rit3zh/expo-morphing-menu)
  as one interaction. The plus hands off to a glass menu, rows appear in sequence,
  the menu expands into a photo grid, and an added photo flies into the measured
  composer thumbnail. It keeps Nyte's controlled draft, camera, staging, and
  annotation. The license and source revision are in [NOTICE.md](NOTICE.md).
- The `@` and `/` menus use native glass, the desktop's command, skill, file, and
  folder glyphs, and a virtualized list that fits above the composer and keyboard.
  They use 4pt gaps and 44pt minimum touch targets. Moving the caret through a
  completed file reference doesn't reopen search.
- The welcome screen uses Nyte's dithered moon. The account button shows the
  signed-in user's image.

React Strict DOM supplies the StyleX-compatible `css` API for native layout. Colors
come from the shared roles in `packages/ui` through `@nyte-ai/ui/platform-colors`,
and `pnpm --dir packages/ui check:tokens` rejects stale native output. The app
follows the system appearance by default. A Settings override goes through
`Appearance.setColorScheme`, so React Native, React Strict DOM, navigation, and
native controls switch together.

Legend List virtualizes messages. Keyboard Controller coordinates the composer and
list insets. Enriched Markdown renders replies natively, respects Reduce Motion, and
highlights code with the shared content roles. While a reply streams, `remend`
closes dangling inline markers, and code highlighting waits for the closing fence.
Host failures for rename, pin, delete, or opening a link appear as toasts, and
loading lists draw skeleton rows.

### References

| Source | Used for |
| --- | --- |
| [Cursor for iOS 1.13.0](https://apps.apple.com/us/app/cursor/id6767085653) | Compact bottom input layout observed in the official App Store screenshots, implemented with Nyte's native input and glass components. |
| [rit3zh/expo-morphing-menu](https://github.com/rit3zh/expo-morphing-menu) at `0aca4280254850ad065987bb8641ba69ae8ac891`, MIT | Ported attachment menu, morph geometry, photo selection, Add-button text animation, thumbnail entry and removal, and photo flight. See [NOTICE.md](NOTICE.md). |
| [Margelo's AI chat demo](https://github.com/margelo/ai-chat-demo) at `6280b1f0f6d53d557b160481185e7bdfa7385cb6` | Chat and keyboard behavior. It has no license file, so none of its source is copied. The app reimplements the patterns with published libraries. Its provider connections, embedded keys, and fake history are not used. |
| Mehdi Davoodi's MIT ChatGPT model-selector demo (`@mehdi_made`) | Thinking gauge geometry and springs |
| [Reacticx](https://github.com/rit3zh/reacticx) at `58479704f1f831913970aa5e78e3691bcb9fa3f7` | Toast and shimmer patterns, reimplemented on Reanimated and Gesture Handler |
| [T3's composer layout](https://github.com/pingdotgg/t3code/blob/68c2277f500bbbb299396bcdcd0aec60dcb5db9d/apps/web/src/components/chat/ChatComposer.tsx#L5925) and [mobile thread feed](https://github.com/pingdotgg/t3code/blob/0c5771d60a8ef2db34dfbbc142f7524badc829e0/apps/mobile/src/features/threads/ThreadFeed.tsx) | The 768pt chat width, compact gutters, and `chat/conversation-layout.ts` measuring one content column and handing rows explicit widths |
| [T3's native header items](https://github.com/pingdotgg/t3code/blob/8657eecb28bc8c767510cc6b9d852b628047c604/apps/mobile/src/features/layout/native-glass-header-items.ts) and [native layout metrics](https://github.com/pingdotgg/t3code/blob/8657eecb28bc8c767510cc6b9d852b628047c604/apps/mobile/src/native/native-layout-metrics.tsx), MIT | Native controls own their glass and screen geometry. Nyte uses Expo Router's measured header and sheet-local safe areas. No T3 source is copied. |
| [Margelo React Native skills](https://github.com/margelo/react-native-skills), [Vercel React Native skills](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-native-skills), [Expo skills](https://github.com/expo/skills) | MMKV, VisionCamera v5, list item types, native UI, routing, and animation guidance |
| [Bluesky's source organization](https://github.com/bluesky-social/social-app/tree/main/src) | Separating startup, screens, and feature components. None of its code or styling is copied. |

## Package choices

| Package | Responsibility |
| --- | --- |
| `expo` 58, React 19.3, React Native 0.88.1 | Native build and runtime |
| `expo-router`, `react-native-screens` | File routes, native stack, sheets, header search, deep links |
| `expo-updates` | Over-the-air updates on fingerprint runtimes |
| `@nyte-ai/sdk`, `@nyte-ai/schema` | Host connection, live stores, request journal, and typed records |
| `@nyte-ai/plugin` | Shared session and tool presentation, and the canvas protocol |
| `@nyte-ai/canvas`, `react-native-webview` | The canvas shell and the web view that draws it |
| `@nyte-ai/connect` | Broker client, account config, enrollment, and the managed-address policy. The app never imports its `signing` entry. |
| `@clerk/expo`, `expo-auth-session`, `expo-web-browser` | Nyte account sign-in through Clerk's hosted page |
| `@expo/ui` 58 | SwiftUI glass buttons, menus, and bottom sheets |
| `expo-glass-effect`, `expo-blur` | Glass composer and menus |
| `react-strict-dom`, `@nyte-ai/ui/platform-colors` | StyleX-compatible native layout and shared Nyte colors |
| `@legendapp/list` | Virtualized transcript and sent-message anchoring |
| `react-native-keyboard-controller` | Native keyboard coordination |
| `react-native-enriched-markdown`, `remend` | Native Markdown and repair of incomplete streamed Markdown |
| `@use-voltra/ios`, `@use-voltra/ios-client` | Live Activity and Dynamic Island |
| `expo-speech-recognition` | On-device dictation and mic level |
| `react-native-vision-camera` 5, `react-native-nitro-modules`, `react-native-nitro-image` | Photo capture and QR scanning |
| `expo-media-library`, `expo-image-manipulator` | Library photos and local JPEG resizing |
| `react-native-svg`, `react-native-view-shot` | Markup strokes and baking annotated photos |
| `react-native-mmkv` 4 | Drafts, the request journal, folder starts, and display preferences |
| `expo-secure-store`, `expo-crypto` | Saved token, Clerk token cache, host pins, and the device bearer and digest |
| `react-native-reanimated`, `react-native-worklets`, `react-native-gesture-handler` | Morphs, the thinking control, and the keyboard |
| `expo-symbols`, `expo-clipboard` | SF Symbols and message copy |
| `@tanstack/react-query` | Host reads per connection |
| `typebox` | Parsing stored records at their boundary |

React DOM stays a peer of React Strict DOM. Metro uses `expo/metro-config` wrapped
with Reanimated's Metro config for clearer error stacks.

## Development

```sh
pnpm --dir packages/mobile typecheck
pnpm --dir packages/mobile test
pnpm --dir packages/mobile bundle
```

`test` runs without native modules. It covers address and pairing-code policy,
account configuration, enrollment, release and revocation against a fake broker and
host, the saved-connection store's ordering, rollback, and restore policy, the
request journal, transcript rows, and the canvas bridge. `bundle` writes a production
Hermes bundle for iOS to `build/export` without a dev server. `dev`, `bundle`,
`typecheck`, `ios:release`, and `ios:build` build `@nyte-ai/canvas` first with
`canvas:build`.

Read [AGENTS.md](AGENTS.md) before changing the app.

### Local builds

`dev`, `ios`, and `prebuild:dev` select the development variant from
[Builds and variants](#builds-and-variants). The Debug build includes `expo-dev-client`, so
local testing needs Xcode and Metro but no EAS build. Only the development variant
registers Expo's generated scheme, so a Metro QR code opens Nyte Dev even when other
variants are installed.

To run on a connected iPhone, enable Developer Mode on the phone, then run:

```sh
pnpm --dir packages/mobile ios --device
```

Pick your Apple team when Xcode asks. Real-device signing needs your own Apple team.

For a local production build, regenerate the project for production and install Pods
again:

```sh
APP_VARIANT=production pnpm --dir packages/mobile prebuild --clean
pod install --project-directory=packages/mobile/ios
```

Then use `ios:release` or `ios:build`. `ios:release` builds and launches a Release
app without Metro. `ios:build` skips Pods and copies the `.app` into `build/app`.
Git ignores `build/`, `ios/`, and `dist/`.

Expo Go can't run this app. Native Markdown, SF Symbols, MMKV, VisionCamera, speech
recognition, Live Activities, and the photo access module all need a development or
Release build. Run `prebuild --clean` and `pod install` again after you change
native dependencies, config plugins, or anything under `modules/`.

Expo generates the native Xcode project from `app.json` and `app.config.ts`. Change
the app config, not the generated files.

Simulator pairing needs ad hoc signing. A build with `CODE_SIGNING_ALLOWED=NO`
compiles but can't save the token in the Keychain. Use Expo's iOS command, or set
`CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=-`.

If CocoaPods picks an SDK from mismatched Command Line Tools, use the selected
Xcode's SDK:

```sh
SDKROOT="$(xcrun --sdk macosx --show-sdk-path)" pod install --project-directory=packages/mobile/ios
```

### Native notes

| Piece | Why it is there |
| --- | --- |
| `modules/nyte-photo-access` | A local Expo module that presents the limited-library picker and resolves when it closes. The installed Expo API has no such callback. Autolinking picks it up from `modules/`, and no shared dependency is patched. |
| `expo-media-library` with `preventAutomaticLimitedAccessAlert` | The photo panel has its own access control, so iOS's automatic limited-access reminder is off. The app asks for photo permission only after an explicit Photos action. |
| MMKV | A Nitro module. It ships Nitrogen output built against `react-native-nitro-modules` 0.35, behind the 0.37 that VisionCamera and Nitro Image use here. Check the Pods build after you upgrade either side. |
| Home-screen icon | `../desktop/build/icon-ios.png`, the desktop artwork on a square plate. The Dock-padded desktop PNG shows a white strip under iOS's mask. |

### Completion icons

The `@` and `/` menus draw the desktop's file, folder, command, and skill glyphs.
`pnpm icons:sync` renders them into `build/completion-icons.json` from the same icon
set `packages/ui` uses. That set is Central Icons when they're installed, which needs
`CENTRAL_LICENSE_KEY`, and Lucide otherwise. `typecheck` runs `icons:sync` first, and
`metro.config.cjs` runs the sync script, so the file exists before TypeScript or
Metro reads it. No web rendering code enters the app bundle.

### Development shortcuts

In a development build, open Expo's developer menu with the floating gear or a
shake. Nyte adds shortcuts for the Inbox, Settings, a conversation, review, and
changed files. Conversation shortcuts use the open session or the host's most recent
one, so connect a host first. The menu also has Live Activity previews for working
and needs input, with their own activity identity and a stop control. They use
sample data and start no host task. See Expo's
[custom developer menu items](https://docs.expo.dev/versions/latest/sdk/dev-menu/#extending-the-dev-menu).

### Device checks

The automated checks don't cover a signed native build, Clerk sign-in, real camera
capture, microphone recognition, or device performance. Before you rely on a build,
check these on a device:

- Send several lines, keep typing while a send is pending, and retry a failed send.
- Queue a follow-up while tools run, then watch the queued bubble land.
- Scroll up during streaming, open tool details, close them, and return to the
  latest message.
- Read long Markdown and shell output with larger text in both appearances.
- Leave a draft, return to it, then switch host and confirm drafts stay separate.
- Dictate, attach and mark up a photo, answer a waiting question, Stop, and review
  files.
