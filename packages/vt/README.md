# @nyte-ai/vt

Terminal emulation for Nyte: a typed binding over Ghostty's libghostty-vt WebAssembly build. The package ships one signed `tip` artifact, `ghostty-vt.wasm`, recorded in `pin.json` by commit and sha256. `loadEngine` checks every export, struct field and enum value it uses against the build's own type manifest, so a pin that changes the ABI fails at load with the name of what moved.

To bump the pin:

```sh
pnpm --dir packages/vt update
pnpm --dir packages/vt test
```

`update` downloads the latest `tip` wasm and its minisign signature, verifies them with Ghostty's public key, checks the wasm is the build Ghostty published for the release's commit, and only then writes the files and `pin.json`.
