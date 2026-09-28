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

```sh
pnpm --dir packages/app dev
```

This serves the app at http://localhost:5179. It asks for a server address and token. To use a desktop instead, open Environments → Remote access → This Mac only and open the link it shows; the desktop serves this app itself. `nyte-serve` (`packages/serve`) does the same without the desktop. Any `@nyte-ai/server` works if it lists the app's origin in `browserOrigins` (see `src/web/origins.ts`).

A link to `/pair?host=<address>&token=<token>` connects without the form. The app remembers the last connection in this browser.

A build served over HTTPS can only reach an HTTPS server address, such as one from Tailscale HTTPS. `pnpm --dir packages/app build` writes the static app to `dist`.

## Checks

```sh
pnpm --dir packages/app typecheck
pnpm --dir packages/app test
```

Electron is a devDependency only for the fixture runner in `test/renderer.ts`. The package itself does not depend on Electron at runtime.
