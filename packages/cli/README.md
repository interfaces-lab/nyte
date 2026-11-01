# nyte-ai

`nyte-ai` installs the `nyte` command, the terminal client for Nyte.

Run it without installing:

```sh
npx nyte-ai
```

Or install it globally:

```sh
npm install --global nyte-ai
nyte
```

The npm package downloads the matching release from
[`interfaces-lab/nyte`](https://github.com/interfaces-lab/nyte), verifies its SHA-256 checksum,
and caches the native executable under `~/.nyte/bin`. Set `NYTE_BIN_DIR` to choose another cache
directory.

To work on Nyte itself, `npx nyte-ai init` sets up a checkout in `./nyte` on macOS or Ubuntu
and needs no download of the binary; `npx nyte-ai init --help` lists what it does. Once `nyte`
runs, `nyte doctor` checks the install and `nyte triage` starts an agent on what doctor finds.

Read the [included guide and runnable examples](docs/README.md). These files ship
with this npm version. For a global install, the guide is at
`$(npm root -g)/nyte-ai/docs/README.md`. A downloaded native release also retains
its guide at `<cache-directory>/<version>/docs/README.md`.
