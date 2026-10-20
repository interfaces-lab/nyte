---
"@nyte-ai/schema": patch
"@nyte-ai/ai": patch
"@nyte-ai/core": patch
"@nyte-ai/plugin": patch
"@nyte-ai/protocol": patch
"@nyte-ai/host": patch
"@nyte-ai/sdk": patch
"nyte-ai": patch
"@nyte-ai/tui": patch
"@nyte-ai/desktop": patch
---

Chats that share a folder no longer count each other's edits. An edit is charged only the file it names, and a shell command that changed files while another chat was working in the folder is marked unattributed instead of charged. A chat's file list, review and patches show only the files its own calls changed.

Agent shell commands run as jobs owned by their chat, so they show in the desktop Terminals pill, Claude Code chats included. `bash` takes `background: true` for servers and watchers, a running command can be moved to the background from its step or the Terminals pill, the chat is told when a background command exits, and the new `job` tool reads a job's output or stops it.
