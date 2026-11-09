# @nyte-ai/vt

Terminal emulation for Nyte. It is a typed binding over the WebAssembly build of Ghostty's libghostty-vt.

## Quick start

```ts
import { readFile } from "node:fs/promises";
import { createTerminal, loadEngine } from "@nyte-ai/vt";

const wasm = await readFile(new URL(import.meta.resolve("@nyte-ai/vt/ghostty-vt.wasm")));
const engine = await loadEngine(wasm);

const terminal = await createTerminal(engine, {
  cols: 80,
  rows: 24,
  cell: { width: 8, height: 16 },
  scrollback: 10_000,
  palette: { foreground: 0xdddddd, background: 0x101010, cursor: 0xffffff, ansi: [] },
  cursor: { style: "block", blink: false },
  newlineMode: false,
  effects: { reply: () => {}, title: () => {}, colorScheme: () => "dark" },
});

terminal.write(new TextEncoder().encode("hello\r\n"));
const frame = terminal.frame(true);
```

## The pinned build

The package ships one signed `tip` artifact, `ghostty-vt.wasm`. `pin.json` records its commit and SHA-256. `loadEngine` checks every export, struct field and enum value the binding uses against the build's own type manifest. If a new pin changes the ABI, `loadEngine` fails and names what moved.

To update the pin, run:

```sh
pnpm --dir packages/vt run update
pnpm --dir packages/vt test
```

Spell out `run`: a bare `pnpm update` is pnpm's own command and upgrades dependencies instead. The script downloads the latest `tip` wasm and its minisign signature and verifies them with Ghostty's public key. It checks that the wasm is the build Ghostty published for the release's commit. Only then does it write the files and `pin.json`.

## Development

```sh
pnpm --dir packages/vt test
pnpm --dir packages/vt typecheck
```
