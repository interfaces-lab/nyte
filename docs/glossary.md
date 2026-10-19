# Glossary

One name per concept. Code uses the **Term**; users see the **UI word** where it differs. Wire and stored names (`packages/schema`, `packages/core/src/contract/records.ts`) keep their current spelling.

| Term | Meaning | UI word | Don't use |
|---|---|---|---|
| session | A conversation on a host: id, workspace, optional parent, heads. `schema/src/sessions.ts` | Chat | thread, conversation, timeline (in identifiers) |
| head | A named pointer into a session's commit tree; `main` by default. | Branch | fork |
| turn | The work one prompt causes. `TurnInfo` in `schema/src/views.ts` | | |
| prompt | The user message that opens a turn. | Message | landing, submitted |
| message | A view message: `kind: "user"` (a prompt) or `kind: "part"`. | | for transcript rows |
| part | A typed piece of agent output: text, thinking, tool call, plugin part. | | |
| step | Consecutive thinking and tool parts grouped in a turn. | | step entry |
| transcript | The virtualized list of rows for one session in one pane. | | timeline, conversation column |
| row | One item in the transcript. Its identity is `key`. | | item, entry, `messageId` (for a row key) |
| row layout | A row's group, lead and sticky placement. | | `RowPlace` |
| subagent | A child session started by the `task` tool. | Subagent | delegate, agents (row kind) |
| workspace | A registered place sessions work in. | Folder | directory, project, cwd (except a real process cwd) |
| host | The process that runs the agent and stores sessions. | | for the selected folder or the Electron shell |
| connection | A principal's authenticated handle on a host. | Server | link |
| pane | One of two chat columns in a tab: `primary` or `secondary`. | | panel |
| panel | A workbench surface: files, changes, terminal, browser. | | pane |
| window tab / workbench tab | Always qualified. | Tab | bare `tab` |
| composer | The input editor with its trays, chips and queue. | | input |
| draft | Unsent composer content. | Draft | for core's fold index |
| warm | Hold a session's live watch before it is opened, so opening it reuses that watch. | | preload, prefetch, prime |
| hot set | The sessions kept warm or mounted, capped by count. | | cache (unqualified) |
