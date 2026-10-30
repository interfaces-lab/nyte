// The login startup and the DEBUG trap composition are adapted from VS Code's shellIntegration-bash.sh,
// Copyright (c) Microsoft Corporation, MIT License (see ./LICENSE and ./UPSTREAM.md).

/** The init file a bash terminal starts with (`bash --init-file <it> -i`, since `--init-file` does not apply to a login shell): it takes the nonce out of the environment, runs the startup files a login shell would, then reports the prompt from the start of `PROMPT_COMMAND` (or bash-preexec's `precmd_functions`) and the first command of each accepted line from a DEBUG trap (or its `preexec_functions`). */
export const bashScript = `# Nyte shell integration, written for one terminal and removed when it exits.
# Adapted from VS Code's bash shell integration, Copyright (c) Microsoft Corporation, MIT License.

{ __nyte_xtrace=$-; set +x; } 2>/dev/null
__nyte_nonce=\${NYTE_SHELL_NONCE-}
export -n __nyte_nonce
unset NYTE_SHELL_NONCE
case $__nyte_xtrace in *x*) set -x ;; esac
unset __nyte_xtrace

if [ -r /etc/profile ]; then . /etc/profile; fi
if [ -r ~/.bash_profile ]; then . ~/.bash_profile
elif [ -r ~/.bash_login ]; then . ~/.bash_login
elif [ -r ~/.profile ]; then . ~/.profile
fi
__nyte_newline=$'\\n'
eval "__nyte_terms=( $(builtin trap -p EXIT) )"
builtin trap -- "[ ! -r ~/.bash_logout ] || . ~/.bash_logout\${__nyte_terms[2]:+$__nyte_newline\${__nyte_terms[2]}}" EXIT

__nyte_emit() {
  { local __nyte_xtrace=$-; set +x; } 2>/dev/null
  builtin printf '\\033]633;Nyte;1;%s;%s\\007' "$__nyte_nonce" "$1"
  case $__nyte_xtrace in *x*) set -x ;; esac
}

__nyte_prompt_begin() {
  local __nyte_status=$?
  __nyte_ready=
  if [[ -z $__nyte_off ]]; then
    if [[ \${NYTE_SHELL_INTEGRATION-} == 0 ]]; then
      __nyte_off=1
      __nyte_emit X
    else
      local IFS=$' \\t\\n'
      local -a __nyte_jobs=($(builtin jobs -p))
      __nyte_emit "A;\${#__nyte_jobs[@]}"
    fi
  fi
  return $__nyte_status
}

__nyte_prompt_end() {
  local __nyte_status=$?
  __nyte_ready=1
  return $__nyte_status
}

__nyte_command() {
  [[ -n $__nyte_off ]] || __nyte_emit C
}

# Passes the incoming status on to a user's DEBUG trap and otherwise returns 0, since with extdebug a failing trap skips the command.
__nyte_preexec() {
  local __nyte_status=$?
  if [[ -n $__nyte_ready && $BASH_SUBSHELL == 0 && -z \${COMP_LINE-} && $BASH_COMMAND != __nyte_prompt_begin* ]]; then
    __nyte_ready=
    __nyte_command
  fi
  [[ -n $__nyte_debug_trap ]] || return 0
  return $__nyte_status
}

# At the top level, since bash 3.2 neither shows a function the DEBUG trap nor keeps one it sets there.
if [[ -n $__nyte_nonce && \${NYTE_SHELL_INTEGRATION-} != 0 ]]; then
  __nyte_off=
  __nyte_ready=
  __nyte_debug_trap=
  if [[ -n \${bash_preexec_imported-} ]]; then
    precmd_functions=(__nyte_prompt_begin "\${precmd_functions[@]}")
    preexec_functions=(__nyte_command "\${preexec_functions[@]}")
  else
    eval "__nyte_terms=( $(builtin trap -p DEBUG) )"
    __nyte_debug_trap=\${__nyte_terms[2]-}
    builtin trap -- "__nyte_preexec \\"\\$_\\"\${__nyte_debug_trap:+$__nyte_newline$__nyte_debug_trap}" DEBUG
    if (( BASH_VERSINFO[0] * 100 + BASH_VERSINFO[1] >= 501 )) &&
      [[ $(declare -p PROMPT_COMMAND 2>/dev/null) == "declare -a"* ]]; then
      PROMPT_COMMAND=(__nyte_prompt_begin "\${PROMPT_COMMAND[@]}" __nyte_prompt_end)
    else
      PROMPT_COMMAND=__nyte_prompt_begin$__nyte_newline\${PROMPT_COMMAND-}\${__nyte_newline}__nyte_prompt_end
    fi
  fi
fi
unset __nyte_terms __nyte_newline
`;
