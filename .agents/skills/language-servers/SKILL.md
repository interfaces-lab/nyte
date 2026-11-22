---
name: language-servers
description: "Add or change a language server the host runs: its `ServerSpec`, its pinned download, its fixture project and its matrix rows. Load it when adding a language or a server, bumping a pinned version, or changing how the host routes LSP requests. Not for the editor's tree-sitter grammars, and not for the shape of an operation's answer."
paths:
  - "packages/host/src/local/language/**"
  - "packages/host/scripts/pin-language-server.ts"
  - "packages/host/test/language-matrix.test.ts"
  - "packages/host/test/fixtures/language/**"
---

# Language servers

The target is VS Code with the language's canonical extension. A language is done when its matrix shows every feature that extension offers, answered by a real server, or names the reason one is missing.

Rule numbers are stable ids. A removed rule leaves a gap.

## Read the sources first

1. **Read the extension, not a summary of it.** Open its `package.json` and the file that builds its language client. Record the initialization options it sends, the `workspace/configuration` sections it answers with their defaults, its middleware, and the server requests it handles.
2. **A server without its extension's settings behaves differently.** rust-analyzer checks on save only when told to. Send what the extension sends by default.
3. **Take download URLs from upstream.** The mason registry (`mason-org/mason-registry`, one `package.yaml` per server) lists the release assets per platform. Use it to find them, then pin from upstream yourself.

## The spec

4. **One file per server** in the `servers` folder beside `spec.ts`, exporting one `ServerSpec`. Add it to `SERVERS` in `servers.ts`.
5. **Order in `SERVERS` is priority.** Where only one answer applies (rename, signature help, formatting, semantic tokens, highlights, hierarchies), the first server that answers wins. Put the server that understands the language before its linters.
6. **`languages` names rows of `LANGUAGES` in the schema.** That table maps file extensions to the identifier LSP knows a file by. Add an extension there when one is missing. Never add a language name in a language branch: it changes a wire type.
7. **`rootMarkers` find the project root.** The nearest folder at or above the file that holds one becomes the server's root, and the workspace folder when none does.
8. **`requiresRootMarker: true` is for a server that runs only when configured.** oxlint takes a file only when its configuration sits at or above it. Its markers are its configuration files.
9. **`program` is looked up first**, in the project's `node_modules/.bin` and `.venv`, then on `PATH`. A found program always wins over a download.
34. **`probe` checks that a found program runs.** rustup and mise put a shim on `PATH` for a tool that is not installed. Give the arguments that make the server print its version and exit 0. A found program that fails them is skipped, and the download is used. The host runs the probe only once the folder is trusted.
10. **`install` is the fallback, and it is data.** `release` is one pinned asset per platform. `npm` is a pinned list of tarballs plus the script to run. `toolchain` runs a program such as `go install`, with `INSTALL_FOLDER` standing for the folder it installs into. `null` means never downloaded: the server ships with a toolchain, or must match the project's own version.
36. **`package` names what is downloaded, and keys the cache.** Servers that ship in one npm package share one `package` and `version` and differ in `entry`, so the package is installed once.
11. **`runtime` names a program the server cannot run without.** The host runs it with `probe` and treats a failure as `missing` with `installHint`. Never download a runtime.
12. **`initializationOptions` and `settings` are plain data.** `settings` answers `workspace/configuration` by dotted section and is sent as `workspace/didChangeConfiguration`.
13. **`prepare` is only for values that depend on the project's disk or on an install**, such as the path of the project's own TypeScript. It may return `initializationOptions`, `settings` and `runsOn`, each replacing the spec's own. A value you can write down goes in the data.
37. **A server that needs a second pinned thing installs it in `prepare`.** `project.install` takes an `Install` and answers where it landed, or null when the host has no installer. The Bash server's shellcheck and a fallback TypeScript are such things. Write its `Install` as data in the spec file.
14. **No server names outside its spec file.** If the manager, a reader or the test needs to know which server it talks to, the spec is missing a field. Stop and report what the spec cannot express.

## Pin the download

15. **Prefer an upstream release, then npm, then a toolchain.** Use Open VSX only when it is the only prebuilt source.
16. **Pin with the script**, from the repository root. The second form writes the tarball list beside the spec.

    ```sh
    node packages/host/scripts/pin-language-server.ts release <url>...
    node packages/host/scripts/pin-language-server.ts npm <lock file> <package@version>...
    ```

17. **Cross-check a GitHub asset.** Its `digest` in the releases API must equal the sha256 the script printed.
18. **Pin every platform upstream ships**, of the six in `PLATFORMS`. Leave out one upstream does not ship. Only this machine's platform gets run, so say which ones are untested.
19. **`bin` is the server's path inside the unpacked archive.** For a single file it is the name the file gets. Archives are `file`, `gz`, `tar.gz` or `zip`.
20. **Check the license before pinning.** Record it in the report. Do not pin a server whose license forbids this use. Report it instead.

## The fixture

21. **One small real project per language** in its own folder under the language fixtures. Five files are enough.
22. **Give every feature something to find**: a diagnostic on purpose, an interface with two implementations, a function with a caller, a call with arguments, a type with a subtype, a line a formatter would change.
23. **The server must load it offline.** No dependency it would fetch, no build output, no vendored tree.
24. **Never change another language's fixture.**

## The matrix

25. **`matrix.json` in the fixture folder holds one row per feature**, every feature of `LanguageFeature` plus `diagnostics`.
26. **A probe says where to ask.** `file` is the path. `after` is text in that file, and the position is right after its first occurrence, so end it inside the symbol. `query` is for workspace symbols. `says` is text the answer must contain.
27. **`servers` lists who offers the feature**, as their status rows say once ready. **`answers` says whether the probes got an answer** through the merged API.
28. **`vscode` says whether VS Code with the extension offers the feature by default.** Put the reason in `note` wherever it differs from `answers`.
35. **The matrix runs the pinned version of every server**, never one from `PATH`. A row describes what Nyte ships. Without `NYTE_LANGUAGE_DOWNLOADS=1` the matrix is skipped.
29. **Record only what a run showed.**

    ```sh
    NYTE_LANGUAGE_DOWNLOADS=1 pnpm --dir packages/host exec vitest --run test/language-matrix.test.ts -t "<fixture folder>"
    ```

30. **A "no" where VS Code says "yes" is a gap to close, not a row to record.** Look for the initialization option or setting the extension sends. Record the gap only once you know why it stays.
31. **Every "no" needs a probe.** The row proves the feature was asked and answered nothing.

## Checks

32. **Run these before reporting**, from the repository root:

    ```sh
    pnpm --dir packages/host exec tsc --noEmit
    pnpm --dir packages/host exec vitest --run test/language-matrix.test.ts test/local-language.test.ts
    pnpm exec oxfmt <files you touched>
    pnpm exec oxlint --type-check <files you touched>
    pnpm operations
    ```

33. **`pnpm operations` must pass unchanged.** A language branch changes no operation and no API revision.
