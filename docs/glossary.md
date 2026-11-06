# Glossary

Each concept has one name. Code uses the term, and users see the UI word where it differs. Wire and stored names in `packages/schema` and `packages/core/src/contract/records.ts` keep their spelling even where it differs from this table.

| Term | Meaning | UI word | Don't use |
|---|---|---|---|
| session | A conversation on a host, with an id, a workspace, an optional parent and heads. See `schema/src/sessions.ts`. | Chat | thread, conversation, timeline (in identifiers) |
| head | A named pointer into a session's commit tree. The default is `main`. | Branch | fork |
| fork | A new top-level session that starts with another session's history through one commit. See `Session.fork`. | Fork | branch, duplicate, copy |
| turn | The work one prompt causes. See `TurnInfo` in `schema/src/views.ts`. | | |
| prompt | The user message that opens a turn. | Message | landing, submitted |
| answer | A late reply to a part's request, sent after the call that asked stopped waiting. It is an attached message with `source.kind: "answer"` that joins a live run or continues an idle one. | | prompt, message (for it) |
| message | A view message, either `kind: "user"` for a prompt or `kind: "part"`. | | for transcript rows |
| part | A typed piece of agent output, such as text, thinking, a tool call or a plugin part. | | |
| step | Consecutive thinking and tool parts grouped in a turn. | | step entry |
| transcript | The virtualized list of rows for one session in one pane. | | timeline, conversation column |
| row | One item in the transcript. Its identity is `key`. | | item, entry, `messageId` (for a row key) |
| row layout | A row's group, lead and sticky placement. | | `RowPlace` |
| subagent | A child session that the `task` or `create` tool starts. | Subagent; Agent in a project | delegate, agents (row kind) |
| workspace | A registered place that sessions work in. | Folder | directory, project, cwd (except a real process cwd) |
| host | The process that runs the agent and stores sessions. | | for the selected folder or the Electron shell |
| connection | A principal's authenticated handle on a host. | Server | link |
| pane | A box in a window tab's layout. It holds one or more pane tabs and shows the active one. | | panel |
| blank | A pane with no session, `PaneSelection` with `kind: "blank"`. It holds one draft until sending starts a session. | New chat | new chat (in identifiers, where it names the action) |
| panel | A workbench tool view, such as files, changes, terminal or browser. | | pane |
| window tab / workbench tab | Always qualified. | Tab | bare `tab` |
| layout | The tree of splits and panes in one window tab. See `Layout` in `panes/layout.ts`. | | row layout (for this), workspace |
| split | A row (`right`) or column (`down`) of two or more layout children, each sized by a share or in pixels. | | group, stack, row, column |
| pane tab | One thing a pane in the layout shows: a chat or a panel. Its `content.kind` names the module that owns it. | Tab | stack, editor group, bare `tab` |
| composer | The input editor with its trays, chips and queue. | | input |
| draft | Unsent composer content. | Draft | for core's fold index |
| image markup | Pen strokes and shapes in source-image pixels, flattened into a copy when added to a chat. | Markup | annotation, drawing (for the feature) |
| warm | Hold a session's live watch before it opens, so opening it reuses that watch. | | preload, prefetch, prime |
| hot set | The sessions kept warm or mounted, capped by count. | | cache (unqualified) |
| stair | One step of a colour ladder (content, fill or stroke), strongest first, with one job and a contrast floor. See the `nyte-styles` skill. | | tier, level, ink-N, interactive-* (for a colour step) |

## Project workflow

Projects exist: a project record, its coordinator chat, the prompt its chats read and the shared docs. The rest of these terms reserve the names for the planned workflow.

| Term | Meaning | UI word | Don't use |
|---|---|---|---|
| project | One coordinator chat in a folder and the settings every chat in it reads on each request: models, instructions, preloaded skills, MCP servers and shared docs. See `schema/src/projects.ts`. | Project | lane, stack, workstream, routine |
| coordinator | A project's own chat. It plans the work and starts the project's agents, its subagents. | Coordinator | lead, keeper |
| shared doc | A file in `.nyte/projects/docs`, under the home or the folder, that a project's chats read and add to. A project turns each one off or on. | Shared context | brief, memory, notes |
| writer family | The one session family allowed to change a checkout, keyed by the checkout's root. The family is a top-level chat and the subagents that share its folder. | | owner or lock (for checkouts) |
| trigger | A project rule. When an event matches, an owner acts on a pinned model until a stop condition, within a budget. | Trigger | subscription, automation, routine |
| pull request watch | The model-free poll that follows one pull request for a project and turns what changed into dispatches. | Watching | watch (alone, which means a session's live watch), listener |
| dispatch | One observed event handed to exactly one owner with a decision: ignore, wake, route, remedy, ask or stop. | | delivery (how a message reaches a run), notification |
| babysitter | The session a project starts on the project's babysitter model to follow one pull request until it is merged, closed or ready. | Babysitter | delegate, watcher |
| keeper | The project session that owns a base branch's failures and failure families, so that a failure many pull requests share gets fixed once. | | |
| gate | The workflows whose checks must pass before a project calls a pull request ready. | Gate | required checks (GitHub's own) |
| remedy | A fix that a project runs as a command, without a model, for a failure it recognises exactly. | | autofix |
| restore | Write chosen paths from a kept snapshot into the writer's own checkout, after taking a fresh snapshot. | Restore | revert, rollback |
