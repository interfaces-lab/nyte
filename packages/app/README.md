# @nyte-ai/app

The Nyte interface. This package holds the React screens, queries and styles that the desktop app and the web app share. The package never talks to a host directly. It reads everything through a `NyteBridge` that its embedding installs. The desktop's bridge reaches the host through Electron's main process, and the web app's bridge in `src/web` connects through `@nyte-ai/sdk`.

## Usage

Call `installBridge` from `@nyte-ai/app/contract/nyte.ts` before anything imports `@nyte-ai/app/theme/boot.ts`. That module reads the bridge while it evaluates, and a read before installation throws. The desktop's renderer entry shows the order:

```ts
import "@nyte-ai/app/theme/faces.ts";
import "./install-bridge.ts"; // calls installBridge(bridge)
import "@nyte-ai/app/theme/boot.ts";
import "@nyte-ai/app/theme/focus-modality.ts";
import "@nyte-ai/app/theme/global.css";
```

The web app does the same in `src/web/install.ts`, the first import of `src/web/entry.tsx`.

Then mount `App` from `@nyte-ai/app`. It takes the embedding's product mark as `appIcon` and a router from `createAppRouter`. The desktop passes its bundled `build/icon-macos.svg`.

## Entry points

- `@nyte-ai/app` exports `App`, `createAppRouter`, `queryClient`, `connectLocalHost`, `startRendererStartup` and the window and startup helpers.
- `@nyte-ai/app/contract/*` holds the bridge contract. `bridge.ts` defines `NyteBridge` and the host, usage and browser types. `nyte.ts` exports `installBridge` and the `nyte` object that reads the installed bridge.
- `@nyte-ai/app/vite` holds the Vite plugins an embedding's build needs, such as `deferredChunks` and `stylex`.
- Other modules have their own subpath in `package.json`, such as `@nyte-ai/app/theme/boot.ts`.
- `@nyte-ai/app/e2e/errors`, `@nyte-ai/app/e2e/scenario-d`, `@nyte-ai/app/e2e/scenario-u-fixture` and `@nyte-ai/app/e2e/scenario-u-trace` share helpers with the desktop's end-to-end suite.

Exports are TypeScript source. The embedding's bundler compiles them.

## Web app

Build the static single-page app into `dist`:

```sh
pnpm --dir packages/app build
```

Production serves it at `https://app.nyte.sh`. The app signs in with your Nyte account and lists your linked hosts, such as the desktop app or the `nyte` CLI on another computer. The browser is only a client. The folders it opens and the edits it makes belong to that host. Phones and browsers are never hosts you can connect to. The [remote access guide](../docs/content/docs/remote-access.mdx) has the user steps.

### Configuration

Set these public build variables in Vercel. Use the same Clerk instance and broker as the desktop and mobile apps.

| Variable | Default | What it does |
| --- | --- | --- |
| `VITE_NYTE_CLERK_PUBLISHABLE_KEY` | unset | Clerk publishable key for account sign-in |
| `VITE_NYTE_CONNECT_ORIGIN` | unset | Nyte Connect broker origin, a canonical HTTPS origin without a trailing slash |

`.env.example` shows both. A missing or invalid value turns off account sign-in and leaves the address-and-token form. For local builds, put the values in a gitignored `.env.local`. The development server uses port 5179.

Add `https://app.nyte.sh`, `http://localhost:5179` and `http://127.0.0.1:5179` to Clerk's allowed origins and web redirect URLs. The broker must authorize the same origins, and the standard session token's audience must match the broker's origin. [`@nyte-ai/connect`](../connect/README.md) covers the Clerk and broker setup. Add `app.nyte.sh` to the Vercel project and configure its DNS by hand.

### Vercel project

Use `packages/app` as the root directory, the Vite preset, `pnpm build` as the build command and `dist` as the output directory. `vercel.json` holds the single-page rewrite, the security headers, and a setting that turns off Vercel's Git deployments. Keep `vercel.json` a regular file. Git stores a symlink as its target path, and Vercel rejects that as an invalid `vercel.json`.

### Connections

The account screen lists linked hosts, with offline hosts disabled. Connecting enrolls a device token for the tab and connects through the broker's relay. The token and the client ID live only in `sessionStorage`, so each tab is its own device and a reload resumes without enrolling again.

- **Switch Desktop** releases the device and reloads into the host list.
- **Sign Out** asks the broker to revoke the device instead of releasing it, then ends the Clerk session.
- Closing a tab forgets the token in the browser, but the server doesn't revoke it, and browser session restoration can bring it back.

The app pins each host's identity per route in `localStorage` on first connection. It refuses a different key at that route until you choose **Pair as New Host**. The pin outlives tokens and sign-outs.

**Use Address and Token** opens the manual form. Manual connections and pairing links of the form `/pair#host=<address>&token=<token>` keep their address and token in `localStorage`. The app removes the pairing fragment from the address bar before routing starts. A manual address must use HTTPS, except HTTP on loopback. A self-hosted server must allow the page's origin.

### Security headers

`vercel.json` sets the CSP, HSTS, `nosniff`, frame denial, the referrer policy and permission restrictions. Canvas pages under `/canvas/` get their own stricter policy. Keep the Clerk Frontend API host in `script-src`, `img-src` and `frame-src` aligned with the publishable key. The defaults allow Clerk development hosts, `clerk.nyte.sh`, and `accounts.nyte.sh` for the account portal.

What the policy allows:

- Scripts from the app, Clerk, and Clerk's Turnstile and fraud-protection hosts. Inline scripts and JavaScript eval are blocked. `'wasm-unsafe-eval'` permits WebAssembly for Ghostty and Shiki, not JavaScript eval.
- Workers from first-party URLs and blobs.
- Fonts from bundled files and Clerk's embedded data fonts.
- Inline styles, because Clerk injects CSS-in-JS and Nyte applies runtime theme variables and layout styles.
- `connect-src` to any HTTPS or secure WebSocket host for manual connections, plus HTTP and WebSocket loopback for local development.

The `connect-src` rule is broader than a broker-only policy. Injected code could send a stolen credential to another HTTPS host. Restricting scripts reduces that risk but can't remove XSS or token theft. Relay calls omit cookies and use bearer-authenticated `fetch`, including for server-sent events.

## Development

```sh
pnpm --dir packages/app test
pnpm --dir packages/app typecheck
```

Some tests run in an Electron renderer for real layout and styles. `test/renderer.ts` builds their fixture with Vite and opens it there. That is the only reason Electron is a dev dependency. The package doesn't use Electron at run time. The web end-to-end suite is in [e2e/README.md](e2e/README.md).

`lint/design-scale.js` is the Oxlint plugin that keeps geometry on the design scale and colors on tokens. The root `oxlint.config.ts` loads it.

Read [AGENTS.md](AGENTS.md) before changing the app.
