# 0005. A lane's rules: skills per role, exact models, commit and PR rules, triggers and limits, read on every turn

Status: accepted, 2026-10-25. Answers questions 4, 6, 9 and 18. Comparison rows: Cursor D2, D3, D10; Assistants D2, D3; Linear D2.

## Context

The user attaches skills by hand: 59 of 1,143 messages in top-level chats carry one (`principles-review` in 26 messages across 24 chats, `review-principles` in 17, `clean-copy` 5, `architect` 5, `unslop` 4). Coordinators retype the rules into every delegation: of 343 first prompts to subagents, 221 name AGENTS.md, restate a style rule, name a skill or warn about the shared tree, and they average 2,912 characters.

Hand-attached skills also rot: the `principles-review` skill the user attached 26 times now lives at `~/.agents/skills/principle-review/SKILL.md`, so every stored attachment names a file that no longer exists at `~/.agents/skills/principles-review/SKILL.md`.

Model choice is per head (`packages/schema/src/configuration.ts`), and a subagent's model must be `provider/id` or an id only one provider has (`packages/core/src/builtins/delegation.ts:322-354`); `gpt-6.1-sol` is offered by openai, openai-codex and github-copilot, so a bare id fails. Cursor workers copy the Project's model by default and users report pricier models starting anyway; OpenClaw users reported per-job model overrides being ignored.

Cursor's coordinator "doesn't write code itself" and that part works; what fails is the shared notes file it rewrites and nobody rereads, and the cloud-only coordinator.

## Decision

A lane holds, as one complete record with no inheritance from other lanes or global defaults:

- **Roles.** A worker, a reviewer and a babysitter, each with a model as an exact catalog reference and a thinking level, and the skills it reads, by name and file location. Polish: worker `openai-codex/gpt-6.1-sol` (medium) reading `nyte-styles`, `clean-copy` and `unslop`; reviewer `anthropic/claude-opus-5-5` (high) reading `principles-review` and `better-interface`; babysitter `openai-codex/gpt-6.1-sol` (low).
- **Checkout.** Every chat the lane starts works in its own worktree on a new branch from `origin/main`, with nothing copied in (ADR 0002).
- **Commit and PR rules**, read from AGENTS.md at setup: the reviewer commits as `type(scope): summary`, branch names of at most three hyphenated words, one PR per fix against `main`, no `.changeset` files; the gate is the `CI` workflow; merging and restacking ask the user.
- **Triggers** (ADR 0006) and **limits**: 4 workers at once, 20 watched PRs, $2 and 3 fix runs per babysat PR, $15 a day, a babysitter lives at most 7 days.
- **Decisions** it points its agents to: the ADRs that apply.
- **Requirements** it checks before the first fix and again on every turn: each skill's file exists at its location, `gh` is signed in, and any MCP server its rules name, by registry name and URL, is configured.

A lane becomes three agents, `lane.<id>` (the reviewer, who coordinates the unit), `lane.<id>.worker` and `lane.<id>.babysitter`, each with the lane's rules and its role's skills as its prompt layer and its role's model pinned. A chat follows a lane by running one of them, so membership cannot disagree with the rules it runs under, and editing a skill or a rule reaches every chat from its next turn because the prompt layer is read when the turn starts. The coordinator is the reviewer: it reads, asks the worker for changes, commits and opens the PR, and never writes the fix itself.

**Creating a lane** is one setup turn on the reviewer model. It takes the user's intent and proposes the rules as a form: skills from the user's own most-attached ones and the repository's `.agents/skills`, models resolved against `/model`, commit and PR rules from AGENTS.md, the gate from the repository's workflows, triggers and limits. It checks `gh auth status` and the required MCP servers, asks only for what it could not find, and starts no work until the user confirms. A lane turns an intent into rules; a big idea with an end is a goal (ADR 0001).

**Dragging a running chat in** sets its main head's agent to the lane's agent with `Head.configure`, passing the model it already runs, and changes nothing else: it keeps its transcript, model, workspace and current run, because a head's configuration applies from its next turn. Before that turn it gets one lane notice naming the rules it now follows. Each PR it opened (ADR 0004) gets a babysitter: a new child session running the lane's babysitter agent, in the worktree that has the PR's branch out or a new one on that branch. If the chat itself writes a shared checkout, the view says so and offers to move the chat's own files into a worktree of its own; it does not move a running chat.

## Consequences

- The 59 hand-attached skills and 221 rule-restating prompts have no reason to exist inside a lane.
- Model ids are validated once, at setup, against the catalog the host actually has.
- A lane rule change is a record update, visible in the lane's history, and reaches every chat without re-sending anything.
- The babysitter's context starts small (the PR, its diff, the failure), so a wake is cheap, and the author chat is woken only when a fix needs a decision it made.
