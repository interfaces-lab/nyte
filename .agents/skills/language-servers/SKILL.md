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
5. **Order in `SERVERS` is priority.** Where only one answer applies (rename, formatting), the first server that answers wins. Put the server that understands the language before its linters.
6. **`languages` names rows of `LANGUAGES` in the schema.** That table maps a file to the identifier LSP knows it by: `ids` by extension, `fileNames` by whole file name, where `*` stands for any text, as in `tsconfig.*.json`. A name wins over an extension. Add an entry there when one is missing, and use `fileNames` for a file whose extension belongs to others, such as `go.mod`. Never add a language name in a language branch: it changes a wire type.
8. **`requiresRootMarker` is for a server that runs only when configured.** oxlint takes a file only when its configuration sits at or above it. Its markers are its configuration files.
34. **A probe catches a shim.** rustup and mise put a shim on `PATH` for a tool that is not installed. Give `probe` the arguments that make the server print its version and exit 0 when `--version` does not.
10. **Leave out `install` for a server that ships with a toolchain or must match the project's own version.**
36. **Servers that ship in one npm package share one install**, as `langserversExtracted` does, so the package is installed once.
11. **Never download a runtime.** A server that cannot run without a program such as cargo names it in `runtime`.
13. **`prepare` is only for values that depend on the project's disk or on an install**, such as the path of the project's own TypeScript. A value you can write down goes in the data.
37. **A server that needs a second pinned thing installs it in `prepare`.** A fallback TypeScript is such a thing. For a program the user may already have, such as the Bash server's shellcheck, use `project.tool`, which prefers the one on `PATH`. Write each `Install` as data in the spec file.
39. **`replies` is only for requests that inform.** A request outside LSP, such as `eslint/noLibrary`, gets "method not found" unless the spec lists a fixed answer. Do not answer yes to a request that asks the editor to do something it will not do; turn off the setting that makes the server ask.
14. **No server names outside its spec file.** If the manager, a reader or the test needs to know which server it talks to, the spec is missing a field. Stop and report what the spec cannot express.

## Pin the download

15. **Prefer an upstream release, then npm, then a toolchain.** Use Open VSX only when it is the only prebuilt source.
43. **Give a toolchain install the `env` it needs both to install and to run.** A gem installed into Nyte's folder needs `GEM_HOME` there both times.
44. **`env` is for what the extension sets on the server's process.**
45. **Only the common set downloads on first open.** It is TypeScript and JavaScript, Python, Rust, Go, C and C++, JSON, CSS, HTML, Markdown, YAML and Bash. Every other server sets `installsOnRequest: true`, so it waits as `available` until the user asks.
46. **Record `bytes` on each release asset of a server that waits to be asked**, from what the pin script prints, so the editor shows the download's size.
16. **Pin with the script**, from the repository root. `npm` writes the tarball list beside the spec. `schemas` writes the JSON server's schema list from SchemaStore's catalog at a commit, keeping only the schemas SchemaStore serves itself, because opening a file fetches its schema. Never edit a written list by hand.

    ```sh
    node packages/host/scripts/pin-language-server.ts release <url>...
    node packages/host/scripts/pin-language-server.ts npm <lock file> <package@version>...
    node packages/host/scripts/pin-language-server.ts schemas <schemas.json> <commit>
    ```

17. **Cross-check a GitHub asset.** Its `digest` in the releases API must equal the sha256 the script printed.
18. **Pin every platform upstream ships**, of the six in `PLATFORMS`. Leave out one upstream does not ship. Only this machine's platform gets run, so say which ones are untested.
20. **Check the license before pinning.** Record it in the report. Do not pin a server whose license forbids this use. Report it instead.

## The fixture

21. **One small real project per language** in its own folder under the language fixtures. Five files are enough.
22. **Give every feature something to find**: a diagnostic on purpose, a function with a caller, a type defined in another file, a line a formatter would change.
23. **The server must load it offline.** No dependency it would fetch, no build output, no vendored tree.
24. **Never change another language's fixture.**
40. **A fixture that needs npm packages pins them.** A linter that lives in the project, such as ESLint or oxlint, cannot run in a bare fixture. Pin the packages with the pin script into a lock file in the fixture folder and name it in the matrix as `packages`, with `bins` for the executables a server is looked up by. Never commit `node_modules`.

## The matrix

26. **End a probe's `after` inside the symbol.** A formatter that changes nothing still answers, so give a format probe a `says` from the text it writes whenever the server formats through a second program.
28. **`vscode` says whether VS Code with the extension offers the feature by default.** Put the reason in `note` wherever it differs from `answers`.
38. **A matrix nobody could run says so.** When the machine lacks the runtime a server needs, add a top-level `unproven` with the reason, such as the runtime that is missing. Its rows then hold what the server's own source declares. Remove `unproven` only with a passing run.
29. **Run one fixture** while you work on it.

    ```sh
    NYTE_LANGUAGE_DOWNLOADS=1 pnpm --dir packages/host exec vitest --run test/language-matrix.test.ts -t "<fixture folder>"
    ```

30. **A "no" where VS Code says "yes" is a gap to close, not a row to record.** Look for the initialization option or setting the extension sends. Record the gap only once you know why it stays.
33. **A language branch changes no operation and no API revision.**
