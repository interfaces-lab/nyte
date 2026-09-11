# Run Nyte

Log in once, then start a conversation from your project directory:

```sh
nyte login
nyte
```

Nyte asks whether you trust the directory. A trusted workspace lets tools read,
edit, and run commands with your process's access. There are no per-tool prompts.
Use an isolated environment when the workspace needs stronger boundaries.

To send one prompt and exit:

```sh
nyte --print -- "Summarize this project's README"
```

Use `--provider <provider>` and `--model <model>` before `--` to select a model.
These requests use your configured provider and may incur charges. Run `nyte login`
interactively before using scripts. A script must also run in a trusted workspace.

Use `nyte --resume` in a terminal to continue the latest conversation.
Installed copies can update with `nyte update`.
That command currently updates only the executable; it does not install the new
release's docs. Run the installer for that version to install its matching docs.

The [source examples](examples/README.md) demonstrate quoted arguments and stdin.
Return to the [guide](README.md).
