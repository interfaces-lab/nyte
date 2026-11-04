# nyte-ai

`nyte-ai` installs the `nyte` command, the terminal client for Nyte.

## Quick start

Run it without installing:

```sh
npx nyte-ai
```

Or install it globally:

```sh
npm install --global nyte-ai
nyte
```

Once `nyte` runs, `nyte doctor` checks the install and `nyte triage` starts an agent on what
`nyte doctor` finds.

## How it works

On first run, the package downloads the matching native release from
[`interfaces-lab/nyte`](https://github.com/interfaces-lab/nyte), verifies its SHA-256 checksum and
caches the executable. Releases exist for macOS on Apple silicon and Linux on arm64 or x64. The
launcher needs Node 26 or later.

| Variable | Default | What it does |
| --- | --- | --- |
| `NYTE_BIN_DIR` | `~/.nyte/bin` | Directory that holds the cached executables |

## Guide

Read the [guide and runnable examples](docs/README.md) that ship with this version. For a global
install, the guide is at `$(npm root -g)/nyte-ai/docs/README.md`. The release the launcher caches
keeps its guide at `~/.nyte/bin/<version>/docs/README.md`, or under `NYTE_BIN_DIR` when you set it.

## Work on Nyte

To set up a checkout of Nyte in `./nyte` on macOS or Ubuntu, run:

```sh
npx nyte-ai init
```

This command doesn't download the native release. To see what it does, run:

```sh
npx nyte-ai init --help
```
