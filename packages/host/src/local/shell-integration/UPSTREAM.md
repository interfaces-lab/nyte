# Upstream

The startup scripts in `zsh.ts` and `bash.ts` adapt portions of Visual Studio Code's shell integration
scripts, `src/vs/workbench/contrib/terminal/common/scripts/` at tag `1.105.1`
(https://github.com/microsoft/vscode/tree/1.105.1/src/vs/workbench/contrib/terminal/common/scripts),
as shipped in Cursor 3.28.5 (`18b4e7e5fb7fc450d7797e36c596c31aedaf59f0`). They are
Copyright (c) Microsoft Corporation and MIT licensed; see `LICENSE`.

Adapted:

- `shellIntegration-env.zsh`, `shellIntegration-profile.zsh`, `shellIntegration-login.zsh` and
  the startup part of `shellIntegration-rc.zsh`: running the user's startup files from a private
  ZDOTDIR, handing their ZDOTDIR back, and moving the default HISTFILE out of the private folder.
- `shellIntegration-rc.zsh`: reporting the prompt from a `precmd` hook and a command from a
  `preexec` hook.
- `shellIntegration-bash.sh`: emulating login startup under `--init-file`, reading an existing
  DEBUG trap through `eval` of `trap -p` (`__vsc_get_trap`), reporting a command once per accepted
  line from the DEBUG trap (`__vsc_preexec_only`, `__vsc_preexec_all`), and using bash-preexec's
  hook arrays when it is loaded. Nyte composes the user's DEBUG trap and every `PROMPT_COMMAND`
  entry rather than wrapping only the first.

Not taken: VS Code's markers, which carry no nonce except on `E`, and its command-line,
environment, cwd, prompt-type and Python activation reports. Nyte's markers are its own
`OSC 633 ; Nyte ; 1 ; <nonce> ; …` extension, parsed in `stream.ts`.
