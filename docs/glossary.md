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
| lane | The rules a stream of work follows (each role's model and skills, commit and PR rules, gate, triggers, limits) and the work in flight under them; standing, or until a goal. | Lane | project, workstream, routine |
| unit | One branch of work in a lane: one session family, one worktree, one branch, at most one pull request. | | task (the tool), job, ticket, item |
| writer family | The one session family, a top-level chat and the subagents sharing its folder, allowed to change a checkout; keyed by the checkout's root. | | owner or lock (for checkouts) |
| trigger | A lane rule: when an event matches, an owner acts on a pinned model until a stop condition, within a budget. | Trigger | subscription, automation, routine |
| pull request watch | The model-free poll that follows one pull request for a lane and turns what changed into dispatches. | Watching | watch (alone: a session's live watch), listener |
| dispatch | One observed event handed to exactly one owner with a decision: ignore, wake, route, remedy, ask or stop. | | delivery (how a message reaches a run), notification |
| babysitter | The session a lane starts to follow one pull request until it is merged, closed or ready, on the lane's babysitter model. | Babysitter | delegate, watcher |
| keeper | The lane session that owns a base branch's failures and failure families, so a failure many pull requests share is fixed once. | | coordinator |
| gate | The workflows whose checks must pass before a lane calls a pull request ready. | Gate | required checks (GitHub's own) |
| remedy | A fix a lane runs as a command, without a model, for a failure it recognises exactly. | | autofix |
| restore | Writing chosen paths from a kept snapshot into the writer's own checkout, after taking a fresh snapshot. | Restore | revert, rollback |
