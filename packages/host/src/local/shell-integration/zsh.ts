// The startup files are adapted from VS Code's shellIntegration-env.zsh, -profile.zsh, -rc.zsh and
// -login.zsh, Copyright (c) Microsoft Corporation, MIT License (see ./LICENSE and ./UPSTREAM.md).

const HEADER = `# Nyte shell integration, written for one terminal and removed when it exits.
# Adapted from VS Code's zsh shell integration, Copyright (c) Microsoft Corporation, MIT License.
`;

/** Runs the user's startup file `name` from their ZDOTDIR as zsh would, at the top level so its declarations stay global, keeping any ZDOTDIR it sets. */
const delegate = (name: string): string => `if [[ -f $__nyte_user_zdotdir/${name} ]]; then
  ZDOTDIR=$__nyte_user_zdotdir
  builtin source $__nyte_user_zdotdir/${name}
  __nyte_user_zdotdir=\${ZDOTDIR:-$HOME}
  ZDOTDIR=$__nyte_zdotdir
fi
`;

/** The files of the ZDOTDIR a zsh terminal starts with: each runs the user's own file of the same name, and `.zlogin` hands ZDOTDIR back and installs `nyte.zsh`'s hooks once the user's startup has finished. */
export const zshFiles = {
  ".zshenv": `${HEADER}
() {
  builtin setopt local_options no_xtrace
  typeset -g __nyte_nonce=\${NYTE_SHELL_NONCE-}
  typeset -g +x __nyte_nonce
  builtin unset NYTE_SHELL_NONCE
}
typeset -g __nyte_zdotdir=$ZDOTDIR
typeset -g __nyte_user_zdotdir=\${NYTE_USER_ZDOTDIR:-$HOME}
if [[ $__nyte_user_zdotdir != "$__nyte_zdotdir" ]]; then
${delegate(".zshenv")}fi
`,
  ".zprofile": `${HEADER}
${delegate(".zprofile")}`,
  ".zshrc": `${HEADER}
if [[ \${HISTFILE-} == "$__nyte_zdotdir/.zsh_history" ]]; then
  HISTFILE=$__nyte_user_zdotdir/.zsh_history
fi
${delegate(".zshrc")}`,
  ".zlogin": `${HEADER}
${delegate(".zlogin")}ZDOTDIR=$__nyte_user_zdotdir
builtin unset NYTE_USER_ZDOTDIR
builtin source $__nyte_zdotdir/nyte.zsh
`,
  "nyte.zsh": `${HEADER}
builtin autoload -Uz is-at-least
if [[ -z $__nyte_nonce || \${NYTE_SHELL_INTEGRATION-} == 0 ]] || ! is-at-least 5.8 ||
  ! builtin zmodload zsh/parameter 2>/dev/null; then
  builtin return 0
fi

typeset -gi __nyte_off=0

__nyte_emit() {
  builtin emulate -L zsh -o no_xtrace
  builtin printf '\\033]633;Nyte;1;%s;%s\\007' $__nyte_nonce $1
}

# Reports the prompt before any user hook runs, so a slow prompt helper never reads as a command.
__nyte_precmd() {
  builtin local __nyte_status=$?
  builtin emulate -L zsh -o no_xtrace
  if (( ! __nyte_off )); then
    if [[ \${NYTE_SHELL_INTEGRATION-} == 0 ]]; then
      __nyte_off=1
      __nyte_emit X
    else
      __nyte_emit "A;\${#jobstates}"
    fi
  fi
  builtin return $__nyte_status
}

__nyte_preexec() {
  builtin local __nyte_status=$?
  builtin emulate -L zsh -o no_xtrace
  (( __nyte_off )) || __nyte_emit C
  builtin return $__nyte_status
}

# zsh runs a bare precmd or preexec before its hook array, so an existing one is wrapped instead.
() {
  builtin emulate -L zsh
  if (( $+functions[precmd] )); then
    builtin functions -c precmd __nyte_user_precmd
    precmd() { __nyte_precmd; __nyte_user_precmd "$@"; }
  else
    precmd_functions=(__nyte_precmd $precmd_functions)
  fi
  if (( $+functions[preexec] )); then
    builtin functions -c preexec __nyte_user_preexec
    preexec() { __nyte_preexec; __nyte_user_preexec "$@"; }
  else
    preexec_functions=(__nyte_preexec $preexec_functions)
  fi
}
`,
};
