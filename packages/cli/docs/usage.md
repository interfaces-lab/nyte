# Run Nyte

Log in once, then start a conversation from your project directory:

```sh
nyte login
nyte
```

`nyte login` lists the providers you can sign in to. `nyte login github-copilot` signs in with a
GitHub device code: open the URL it prints, enter the code, and Nyte loads the models your Copilot
account can use. This uses the GitHub Copilot OAuth app used by Pi, not a Nyte or OpenCode app.
Nyte exchanges the GitHub token for a short-lived Copilot session token and refreshes it as needed.
Existing direct-token Copilot logins need a fresh sign-in after upgrading. Nyte is not an officially
supported Copilot client; the account needs Copilot access.

Tools read, edit, and run commands in the directory with your process's access.
There are no per-tool prompts. Use an isolated environment when the workspace needs
stronger boundaries.

To send one prompt and exit:

```sh
nyte --print -- "Summarize this project's README"
```

Use `--provider <provider>` and `--model <model>` before `--` to select a model.
These requests use your configured provider and may incur charges. Run `nyte login`
interactively before using scripts.

Use `nyte --resume` in a terminal to continue the latest conversation.
Installed copies can update with `nyte update`. Run `nyte update --models` to refresh the model catalog without updating Nyte. The update command installs the new
release's docs beside the executable when the release archive carries them.

The [source examples](examples/README.md) demonstrate quoted arguments and stdin.
Return to the [guide](README.md).
