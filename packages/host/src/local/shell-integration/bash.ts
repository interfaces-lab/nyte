// Adapted from VS Code's shellIntegration-bash.sh, Copyright (c) Microsoft Corporation, MIT License (see ./LICENSE).

export const HEADER = `# Adapted from VS Code, Copyright (c) Microsoft Corporation, MIT License.
`;

export const REPORT = `IFS= builtin read -r __nyte_nonce 2>/dev/null <"$__nyte_dir/nonce"
builtin printf '\\033]633;Nyte;1;%s;%s\\007' "$__nyte_nonce" "$1"
`;

export const bashScript = `${HEADER}__nyte_dir=\${BASH_SOURCE[0]%/*}
if [ -r /etc/profile ]; then . /etc/profile; fi
if [ -r ~/.bash_profile ]; then . ~/.bash_profile
elif [ -r ~/.bash_login ]; then . ~/.bash_login
elif [ -r ~/.profile ]; then . ~/.profile
fi
__nyte_nl=$'\\n'
eval "__nyte_terms=( $(builtin trap -p EXIT) )"
builtin trap -- "[ ! -r ~/.bash_logout ] || . ~/.bash_logout\${__nyte_terms[2]:+$__nyte_nl\${__nyte_terms[2]}}" EXIT
__nyte_emit() {
{ local __nyte_xtrace=$-; set +x; } 2>/dev/null
local __nyte_nonce
${REPORT}case $__nyte_xtrace in *x*) set -x;; esac
}
__nyte_prompt() {
local __nyte_rc=$?
__nyte_ready=
if [[ -n $__nyte_off ]]; then :
elif [[ \${NYTE_SHELL_INTEGRATION-} == 0 ]]; then __nyte_off=1; __nyte_emit X
else
local IFS=$' \\t\\n'
local -a __nyte_jobs=($(builtin jobs -p))
__nyte_emit "A;\${#__nyte_jobs[@]}"
fi
return $__nyte_rc
}
__nyte_prompt_end() {
local __nyte_rc=$?
__nyte_ready=1
return $__nyte_rc
}
__nyte_command() { [[ -n $__nyte_off ]] || __nyte_emit C; }
__nyte_preexec() {
local __nyte_rc=$?
if [[ -n $__nyte_ready && $BASH_SUBSHELL == 0 && -z \${COMP_LINE-} && $BASH_COMMAND != __nyte_prompt* ]]; then __nyte_ready=; __nyte_command; fi
[[ -n $__nyte_debug ]] || return 0
return $__nyte_rc
}
if [[ \${NYTE_SHELL_INTEGRATION-} != 0 ]]; then
__nyte_off=
__nyte_ready=
__nyte_debug=
if [[ -n \${bash_preexec_imported-} ]]; then
precmd_functions=(__nyte_prompt "\${precmd_functions[@]}")
preexec_functions=(__nyte_command "\${preexec_functions[@]}")
else
eval "__nyte_terms=( $(builtin trap -p DEBUG) )"
__nyte_debug=\${__nyte_terms[2]-}
builtin trap -- "__nyte_preexec \\"\\$_\\"\${__nyte_debug:+$__nyte_nl$__nyte_debug}" DEBUG
if (( BASH_VERSINFO[0] * 100 + BASH_VERSINFO[1] >= 501 )); then
PROMPT_COMMAND=(__nyte_prompt "\${PROMPT_COMMAND[@]}" __nyte_prompt_end)
else
PROMPT_COMMAND=__nyte_prompt$__nyte_nl\${PROMPT_COMMAND-}\${__nyte_nl}__nyte_prompt_end
fi
fi
fi
unset __nyte_terms __nyte_nl
`;
