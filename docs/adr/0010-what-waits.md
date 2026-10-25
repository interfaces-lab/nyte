# 0010. What waits, and the one choice now that keeps each possible

Status: accepted, 2026-10-25. Answers questions 10, 14 and 15. Comparison rows: Cursor D5; Linear D3, D9; MCP and PR agents D9.

| Waits | Why it waits | The choice now that keeps it possible |
|---|---|---|
| Another Mac's lanes, behind a toggle | Each Mac has its own store (`~/.nyte/nyte.db`) and Connect links a client to one host per environment, at most three per owner; showing another host's lanes needs a read-only remote listing and a merge of two lists. | Lane, observation and dispatch records carry the host they belong to and their ids are scoped by host; sessions, worktrees and the PRs derived from them already belong to one host's store. Two lists then merge without collisions. |
| Linear sync as a feature | The Linear MCP server was not connected in this round; ADRs are the source of decisions, and a two-way sync needs conflict rules nobody has asked for. | Decisions are numbered files (`docs/adr/NNNN-*.md`), so a one-way mirror maps each to one Linear issue in a project with a target date. |
| A marketplace with sign-in on demand | The Polish lane needs no new MCP server; MCP's URL-mode elicitation (2026-07-28 revision, the client shows the full URL and asks consent) and the registry's v0.1 API make it buildable later. | Lane requirements name MCP servers by registry name and URL; a run waiting on a sign-in is resumed when it completes, the step Rakazo's connect card misses. |
| Lanes that run until a goal, with tickets and progress | Linear already models goals (Project, target date, issues), and Polish is standing. | The lane already carries `until`; a goal lane adds a ticket source, not a second concept (ADR 0001). |
| An assistant kernel, workflows, a meeting-notes recorder, a second brain | One consumer exists (ADR 0009). | The trigger contract takes no coding types. |
| Lanes that keep working while the Mac sleeps | Local by default; a cloud runner is a different product. | Watches pause in sleep and catch up with one tick on wake, so adding a remote runner later changes where ticks run, not what they deliver. |
