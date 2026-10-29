# Chat experience

A behaviour spec of Cursor Glass 3.28.5's chat, written in our words, and the plan that turns it into Nyte's next chat experience.

| File | Covers |
| --- | --- |
| [01-sidebar.md](01-sidebar.md) | Sidebar model, row states, actions, hover card, proportions |
| [02-composer.md](02-composer.md) | Composer states and input routing, waiting messages, dock row, model picker, focus, proportions |
| [03-transcript.md](03-transcript.md) | Rows, heights, scrolling, pinned prompt, unread model, progress summaries, blocks, proportions |
| [04-shell.md](04-shell.md) | Tabs and the preview slot, subagent tabs, attention outside the chat, right panel, proportions |
| [plan.md](plan.md) | Goals, work items, status and the definition of done |
| [audits/](audits) | How each spec was checked against the shipped bundle, with corrections and open runtime checks |

## How it was made

GPT-6.1 Sol workers read the formatted Glass bundle (`workbench.glass.main.js`, minified sha256 prefix `27cbde700afaa52a`) one area each and drafted reports. Claude Opus 5.5 auditors checked those drafts claim by claim against the cited lines and against Nyte's source, then wrote the four specs. Evidence tags point at lines in that formatted bundle: `[code glass.js:LINE]` or `[inferred: reason]`.

The specs describe behaviour and proportions. They contain no Cursor code. Nothing here was observed in a running Glass; each spec ends with the runtime checks still open.
