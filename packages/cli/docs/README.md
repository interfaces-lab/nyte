# Nyte guide

This guide and its examples ship with the Nyte release you installed. Keep the guide that matches
the `nyte` version you use.

## Get started

Sign in to a model provider, then start a session in the folder you want the agent to work in:

```sh
nyte login
nyte
```

To run one prompt and print the answer:

```sh
nyte -p "Summarize this project's README"
```

To check the install:

```sh
nyte doctor
```

`nyte triage` starts an agent on the problems `nyte doctor` finds. Run `nyte --help` to list every
command.

## Examples

The [examples](examples/README.md) are shell scripts that run `nyte` on a prompt. They use only the
installed `nyte` command, so they need no other packages.

## Where to find this guide

| Install | Guide location |
| --- | --- |
| npm | `nyte-ai/docs/README.md` inside the npm package |
| Install script | `<install-directory>/../share/nyte/<version>/docs/README.md`, by default `~/.local/share/nyte/<version>/docs/README.md` |
| Unpacked archive | `docs/README.md` beside the `nyte` executable |

The npm package records its version in `package.json`. A native archive records it in `VERSION`
beside the executable.
