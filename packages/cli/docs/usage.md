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

## Delegated tasks

The agent waits for a delegated task by default. It can start independent work in the
background, then use `wait_task` with that job's ID when it needs the report. The parent
continues after the existing task finishes; it does not launch a replacement or poll.
`stop_task` cancels the task. These are agent tools, not terminal commands.

A background report cannot restart a finished or stopped conversation. If the parent
already finished, the report stays queued for your next message.

The [source examples](examples/README.md) demonstrate quoted arguments and stdin.
Return to the [guide](README.md).
