# @nyte-ai/app

The Nyte interface: React screens, queries, and styles shared by the desktop app and the web app. The package does not talk to the SDK directly. It reads everything through a `NyteBridge` that the host supplies. The desktop carries the bridge over Electron IPC; the web app in `src/web` carries it over `@nyte-ai/client`.

The host calls `installBridge(bridge)` before the first import that reads the bridge. `theme/boot.ts` reads it while the module evaluates, so the call has to come first. The desktop does this in `packages/desktop/src/renderer/src/install-bridge.ts`, which is the first import of its `main.tsx`; the web app does it in `src/web/install.ts`, the first import of `src/web/entry.tsx`.

## Layout

- `src/bridge.ts`: the bridge contract (`NyteBridge`, `HostBridge`, and the host, usage, and browser types).
- `src/nyte.ts`: `installBridge` and the `nyte` facade. Every read goes to the installed bridge, and a read before installation throws.
- `src/index.ts`: the entry a host mounts from (`installBridge`, `App`, `router`, `queryClient`, `startRendererStartup`, `loadLocalResources`, `connectSessionDirectory`). `App` takes the host's product mark as `appIcon`; the desktop passes its bundled `build/icon-macos.svg`.
- `test/renderer.ts`: builds a fixture with Vite and runs it in an Electron renderer, for tests that need real layout and styles.
- `lint/design-scale.js`: the Oxlint plugin that keeps geometry on the design scale and colors on tokens. The root `oxlint.config.ts` loads it.

Other modules are imported by path through the `./*` export, for example `@nyte-ai/app/errors.ts`. Exports are TypeScript source; the host's bundler compiles them.

## Web

`pnpm --dir packages/app build` writes a static SPA to `dist`. At `https://app.nyte.sh`, sign in with your Nyte account and pick a linked desktop. The browser is a client: its workspace and edits belong to that desktop. Phones and browsers are never connection targets.

Set these public build variables in Vercel, using the same Clerk instance and broker as desktop and mobile:

- `VITE_NYTE_CLERK_PUBLISHABLE_KEY`
- `VITE_NYTE_CONNECT_ORIGIN`, a canonical HTTPS origin without a trailing slash

See `.env.example`. Missing or invalid values disable account sign-in and leave the address-and-token form. Local builds can use a gitignored `.env.local`. Development uses port 5179.

Add `https://app.nyte.sh`, `http://localhost:5179`, and `http://127.0.0.1:5179` to Clerk's allowed origins and web redirect URLs. The broker must authorize the same origins and the standard session token's audience must match its origin. See `packages/connect/README.md`. Add `app.nyte.sh` to the Vercel project and configure its DNS manually.

### Connections

The account picker lists linked desktops and their broker-reported online state. Enrollment sends a random device token's digest, waits for the desktop's lease to accept it, and connects through the broker's relay. The token, binding, and owner-scoped client ID live only in `sessionStorage`. Reloading resumes that credential without enrollment. Each tab has its own client ID so tabs do not replace one another's devices.

Switch Desktop weakly releases the bearer and reloads into the picker with fresh router and query state. Sign Out also asks the broker to revoke the device and ends the Clerk session. Both forget the credential even when the desktop is offline. A Clerk owner change also drops the connection and reloads, keeping the previous desktop's UI state out of the next account. Closing a tab forgets it client-side, but does not guarantee server revocation, and browser session restoration may restore it. There is no unload release: browsers cannot reliably distinguish a tab close from a reload, and releasing on both breaks resume.

Use Address and Token opens the existing manual form. Manual and `/pair#host=<address>&token=<token>` connections keep their localStorage behavior. Pairing fragments are removed before browser-history routing mounts. From an HTTPS page, manual hosts must also use HTTPS. Self-hosted servers must allow the page origin in `browserOrigins`.

### Security headers

`public/vercel.json` carries the SPA rewrite, CSP, HSTS, MIME sniffing protection, frame denial, referrer policy, and permissions restrictions. `vercel.json` links to it so Vercel reads the headers as project configuration. Use `packages/app` as the Vercel root directory, the Vite preset, `pnpm build`, and `dist` as the output directory. Keep the Clerk Frontend API hostname in `script-src`, `img-src`, and `frame-src` aligned with the publishable key. The defaults allow Clerk development hosts and `clerk.nyte.sh`, plus `accounts.nyte.sh` for its account portal.

Scripts are limited to the app, Clerk, and Clerk's Turnstile and fraud-protection hosts. Inline scripts and JavaScript eval are blocked. `'wasm-unsafe-eval'` permits Ghostty and Shiki's WebAssembly, not JavaScript eval. Workers allow first-party URLs and blobs. Fonts allow bundled files and Clerk's embedded data fonts. Styles allow `'unsafe-inline'` because Clerk injects CSS-in-JS and Nyte applies runtime theme variables and layout styles.

`connect-src` allows HTTPS and secure WebSockets to arbitrary hosts for manual connections, plus HTTP and WebSocket loopback for local development. This is broader than a broker-only policy: injected code could send a stolen credential to another HTTPS host. Restricting scripts reduces that risk but cannot eliminate XSS or token theft. HTTPS pages still enforce mixed-content restrictions. Nyte relay calls omit cookies and use bearer-authenticated fetch, including SSE; native EventSource is not used.

### Reference differences

The Clerk provider and fresh-token callback follow t3code's hosted app. Nyte uses its existing mobile digest-enrollment and bearer contract rather than t3code's DPoP authorization, IndexedDB keys, and managed transport. The provider is imported statically to meet Nyte's import rules; clerk-js is still loaded only when account configuration is valid. Switching reloads instead of adopting t3code's multi-environment runtime. The account gate stays before the router mounts, as Nyte's web entry already does.

## Checks

```sh
pnpm --dir packages/app typecheck
pnpm --dir packages/app test
```

Electron is a devDependency only for the fixture runner in `test/renderer.ts`. The package itself does not depend on Electron at runtime.
