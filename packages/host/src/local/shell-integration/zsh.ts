// Adapted from VS Code's zsh shell integration, Copyright (c) Microsoft Corporation, MIT License (see ./LICENSE).

import { HEADER, REPORT } from "./bash.ts";

/** Runs at the top level so the user's declarations stay global, keeping any ZDOTDIR the file sets, and never Nyte's own file. */
const delegate = (
  name: string,
): string => `if [[ $__nyte_user_dir != "$__nyte_dir" && -f $__nyte_user_dir/${name} ]]; then
ZDOTDIR=$__nyte_user_dir
builtin source $ZDOTDIR/${name}
__nyte_user_dir=\${ZDOTDIR:-$HOME}
ZDOTDIR=$__nyte_dir
fi
`;

/** The nonce is read from the folder at each report so no variable, function or environment holds it; `.zlogin` hands ZDOTDIR back only after the user's last startup file, since zsh reads each from ZDOTDIR; `__nyte_precmd` comes first in the hooks so a slow prompt helper never reads as a command, and zsh runs a bare precmd or preexec before its hook array, so an existing one is wrapped instead; unindented to fit the host's startup budget. */
export const zshFiles = {
  ".zshenv": `${HEADER}typeset __nyte_dir=$ZDOTDIR
typeset __nyte_user_dir=\${NYTE_USER_ZDOTDIR:-$HOME}
builtin unset NYTE_USER_ZDOTDIR
${delegate(".zshenv")}`,
  ".zprofile": HEADER + delegate(".zprofile"),
  ".zshrc": `${HEADER}if [[ \${HISTFILE-} == "$__nyte_dir/.zsh_history" ]]; then HISTFILE=$__nyte_user_dir/.zsh_history; fi
${delegate(".zshrc")}`,
  ".zlogin": `${HEADER}${delegate(".zlogin")}ZDOTDIR=$__nyte_user_dir
builtin source $__nyte_dir/nyte.zsh
`,
  "nyte.zsh": `${HEADER}builtin autoload -Uz is-at-least
if [[ \${NYTE_SHELL_INTEGRATION-} == 0 ]] || ! is-at-least 5.8 || ! builtin zmodload zsh/parameter 2>/dev/null; then builtin return 0; fi
typeset -gi __nyte_off=0
__nyte_emit() {
builtin local __nyte_nonce
${REPORT}}
__nyte_precmd() {
builtin local __nyte_rc=$?
builtin emulate -L zsh -o no_xtrace
if (( __nyte_off )); then :
elif [[ \${NYTE_SHELL_INTEGRATION-} == 0 ]]; then __nyte_off=1; __nyte_emit X
else __nyte_emit "A;\${#jobstates}"
fi
builtin return $__nyte_rc
}
__nyte_preexec() {
builtin local __nyte_rc=$?
builtin emulate -L zsh -o no_xtrace
(( __nyte_off )) || __nyte_emit C
builtin return $__nyte_rc
}
() {
builtin emulate -L zsh
if (( $+functions[precmd] )); then
builtin functions -c precmd __nyte_user_precmd
precmd() { __nyte_precmd; __nyte_user_precmd "$@"; }
else precmd_functions=(__nyte_precmd $precmd_functions)
fi
if (( $+functions[preexec] )); then
builtin functions -c preexec __nyte_user_preexec
preexec() { __nyte_preexec; __nyte_user_preexec "$@"; }
else preexec_functions=(__nyte_preexec $preexec_functions)
fi
}
`,
};
