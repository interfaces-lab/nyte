# Transcript audit

Scope: the transcript area of the Cursor Glass 3.28.5 chat spec. Covers the list engine, rows, estimates and caches, follow/read, anchoring, history, saved position, pinned prompt, unread pill and divider, progress summaries, transcript blocks, and the parent's inline subagent link.

Sources audited: workers `11-transcript-engine.md` (deep pass), `01-attention-in-chat.md`, `06-progress-summaries.md`, `07-transcript-blocks.md`, and the inline-link parts of `05-subagent-tabs.md`. Every claim below was checked by opening the cited window of `/tmp/glass/glass.js` (formatted, 944,931 lines, minified sha256 prefix 27cbde700afaa52a), `glass.css` or `nls.messages.json`, and Nyte's `origin/main` source in the chat-experience worktree. Nothing was run. No app was launched.

Output: `../03-transcript.md`.

## Summary

| Report | Checked | Confirmed | Corrected | Unsupported / dropped |
|---|---|---|---|---|
| 11 transcript engine | 70 | 62 | 4 | 4 |
| 01 attention in chat | 30 | 25 | 3 | 2 |
| 06 progress summaries | 24 | 21 | 2 | 1 |
| 07 transcript blocks | 22 | 20 | 2 | 0 |
| 05 subagent tabs (inline link only) | 8 | 6 | 1 | 1 |
| **Total** | **154** | **134** | **12** | **8** |

I checked every row of report 11's state, attention and mechanism tables, every row of report 01's state and attention tables, and every unread-model claim in all reports. In 06 and 07 I checked about two thirds of the claims, covering every count rule, every label with a number in it, and the actions-row order.

The brief's premise also needed one correction: the 840 px width token (C13 below).

Confidence:
- **High** for the row model, estimates, height cache, follow/release/rejoin thresholds, the unread state machine, sticky selection, summary wording and counts, and the citation card. I read each of these in code, end to end.
- **Medium** for history paging (traced only for cloud chats), reveal timing (one default read, host overrides not traced), and work-group fold defaults.
- **Low** for anything painted: pixel placement, animation, focus after jumps, screen-reader output. Those are listed below as runtime checks.

Report quality: report 11 was accurate. Most of its "[inferred]" tags turned out to be checkable, and I confirmed them. Its weak spots were scope statements ("only", "1,000 per chat to disk"). Report 01 misread Nyte. Report 06 had one arithmetic error. Report 07 left out one control.

## Corrections

| # | Report | Claim | Finding | Evidence |
|---|---|---|---|---|
| C1 | 11 §c | The height cache keeps 1,000 heights per chat and writes them to disk on shutdown. | **Corrected.** Memory holds up to 1,000 heights and 200 folds per chat for 32 chats. A save writes only two sets of rows: those in the chat's most recent visible window and those visible when the chat was first opened. Each row is written only if its layout key matches the current one. A chat is skipped if its content is unchanged and was saved less than an hour ago. Each save covers at most 16 chats, and pruning keeps the 64 newest on disk. A chat's record is prefetched from disk when its data handle loads. | [code glass.js:478345 limits; 478430–478452 save loop over `window.rowIds` + `openWindow`, `Hmv` = 1 h; 478456 prune; 771153 shutdown; 771529–771533 prefetch on handle load] |
| C2 | 11 §c | Pretext is used only for older, unexpanded human rows. | **Corrected scope.** The bundle has two uses. In ordinary chat it is used only by the prompt-height precompute, which is wired on in the main chat path. The second use binary-searches the tightest width so that human bubbles shrink-wrap their text, and it runs only in the project bubble lane. | [code glass.js:477717–477723 and 477893 height precompute; 504301 `computedHeights` wired; 485273–485277 and 485444 shrink-wrap, enabled only when `inProjectBubbleLane`] |
| C3 | 11 §g | The active sticky prompt is the last eligible prompt that has reached the edge. | **Refined.** The engine takes the most recent prompt whose top has reached the edge plus 2 px. If that prompt is as tall as the viewport or taller, no prompt sticks; the engine does not fall back to an earlier one. | [code glass.js:463637–463650, 463716] |
| C4 | 11 §5 | Nyte has "explicit follow/reading/held states". | **Corrected.** Nyte has two modes, following and reading. "Held" is an event that puts Nyte into reading with an element anchor. | [Nyte transcript-mode.ts:9–18, 41–42] |
| C5 | 01 §6 | Nyte has no persisted unread boundary, so drop it. | **Wrong reading of Nyte, and I reverse the decision.** Nyte already stores a seen commit per head for each principal. It advances that commit under Glass's rule: the chat is shown, the window is visible and focused, and the workbench is not covering it. What's missing is that clients only get an `unread` boolean, not the seen mark itself. Building the divider is a schema-exposure job, not new state. | [Nyte core/src/fold/seen.ts:18–50; core/src/fold/project.ts:107–126; schema/src/sessions.ts:19; app/src/screens/session-conversation.tsx:250–296] |
| C6 | 01 §9 | The pill's placement is unknown. | **Resolved from static CSS.** The pill is absolutely positioned 12 px below the top of the transcript area, centred across the transcript column, for both directions. It is a 28 px outlined control with 8 px corners, an elevated background and a small shadow. | [glass.css `.glass-10l6tqk/.glass-e6tamo/.glass-1sscnwy/.glass-dfdp04`; glass.js:683936 size "lg"; `--cursor-height-lg:28px`, `--cursor-radius-lg:8px`] |
| C7 | 01 §2 | A typing-bubble status may show. | **Dropped from the spec.** The default transcript capability set turns the typing bubble off. | [code glass.js:478690 `typingBubble: false`] |
| C8 | 06 §1 | Positive durations from 500 ms that round below one second show a decimal second. | **Wrong.** The seconds value is the duration rounded to the nearest second, and 500 ms rounds to 1. So 500–1,499 ms reads "1s", under 500 ms reads "briefly", and the decimal branch can't be reached for ordinary thoughts. | [code glass.js:186364–186366, 186515] |
| C9 | 06 (omission) | Not covered. | **Added.** A completed turn folds its work, everything before the final reply, into one "Worked for 2m 47s" group. While the turn is active the group reads "Working". The same duration appears as the timestamp tooltip's subtitle. | [code glass.js:192225–192235, 208148–208157, 191967–192032, 194593] |
| C10 | 07 §1 | The actions row is feedback, copy, fork, relative time. | **Incomplete.** A conditional "Reply" control sits between fork and the time, and the copy control has an overflow menu. Order: feedback, copy (with menu), fork, reply, time. | [code glass.js:194621] |
| C11 | 07 §2 | The reply-copy notification is at 502596. | **Citation off by one.** The notification is at 502597. Duplicates exist at 476746 and 476777. The wording "Message copied to clipboard" is confirmed. | [code glass.js:502597] |
| C12 | 05 §6 | Nyte's inline child citation: keep. | **Keep, plus one gap.** Glass swaps the link's leading glyph for an animated working glyph while the child is generating. Nyte always shows the static agent icon. | [code glass.js:471662–471665; Nyte subagent-call.tsx:589–591] |
| C13 | Brief premise (proportions) | `--composer-max-width: 840px` is the transcript column width. | **Not the effective default.** 840 px is only a CSS fallback. The Glass shell computes the width from the chat-width setting: 780 px when the user hasn't set it, plus 16 px reserved for scrollbar gutters, which gives 796 px. The 16 px inline padding goes inside that box, leaving a 764 px text column. In Glass mode, assistant and tool rows are inset a further 13 px on each side. | [code glass.js:535540–535545 (780 default, +2×8 gutter); 684366 tab wrapper uses it; 575194 sets `--composer-max-width`; 504323 inline padding 16 px; glass.css row-body `margin-inline: var(--conversation-glass-corner-rule)` = 12 + 1 px] |

## Unsupported or dropped

| # | Report | Claim | Why |
|---|---|---|---|
| U1 | 11 §c | A text heuristic assumes about 102 characters per line, capped at 12,000 px. | Not verified. Not needed: the spec states estimate rules, not Glass's heuristic. |
| U2 | 11 §c | An eight-entry identity/epoch LRU. | I saw the constant 8 but didn't trace the eviction. It's an implementation detail, so dropped. |
| U3 | 11 §2 | "Gesture-held correction" as a state. | A mechanism, not something the user sees. Folded into the anchoring rule: "corrections above the fold wait for the gesture to end". |
| U4 | 11 §2 | "Following suspended" as a state. | A host override with no user-visible trigger in the transcript. Dropped. |
| U5 | 01 §1–3 | Terminal chip and terminal list rows. | Outside the transcript. They belong to the composer and attention audits. |
| U6 | 01 §2 | "Transcript work active or settled" as an attention row. | It's a duplicate of the progress summaries and is covered there. |
| U7 | 06 §1 | "Closed is not an immutable snapshot". | Speculative edge case. Dropped under the repo rule on unlikely cases. |
| U8 | 05 §1–4 | Child tabs, tray, close dialogs. | Outside the inline-link scope. |

## Confirmed claims (high-value, abbreviated)

- **Engine.** The chat uses a custom plane, not TanStack. Defaults: rows overscan 56 and 1,600 px, both limits per side, enforced together. Pin 4 px, input window 250 ms, drift 2 px, gap 14 px, sticky epsilon 2 px, disclosure settle 350 ms. Rows are absolutely positioned, with native overflow anchoring off. [glass.js:191433, 472376, 463685–463728, 463770, 477483–477489, 477607]
- **Rows and identities.** Kind prefixes `human:`, `assistant-markdown:`, `activity:`, `activity-group:<lane>:<first>`, `tool-placeholder:`, `host-row:`, `notification:`, `work-group:…:<final reply row>`, `turn-actions:<human row>`, `unread-divider:<bubble>`. Time-boundary rows are never anchors. [glass.js:191603–191715, 192167–192171, 192235, 192344, 472772]
- **Estimates.** Human 52, assistant 60 (raised to a saved content hint or reserved minimum once settled), thinking 36, tool 29, host 36, single line 24 in Glass and 22 otherwise. Time and unread dividers 28, turn actions 36, end summary 180, reply quote +64. Committed height comes first, then computed height, then the kind estimate. [glass.js:209817–209850, 208081, 208450, 451964, 266500–266506, 472772]
- **Measurement policy.** Settled rows accept one correction per revision. Streaming rows only grow. Changes within 2 px are ignored. Media loading or a disclosure toggle starts a new revision. [glass.js:463059–463075, 463124–463128, 477487]
- **Follow/release/rejoin.** Covered in full in spec §3. [glass.js:462838–462860, 463323–463360]
- **"At bottom" for UI.** Pinned, or within 50 px. Saved-position capture treats ≤ 2 px as the end. [glass.js:324352–324358, 477503, 463659–463683]
- **Saved position.** Kept in memory per owner store and keyed by agent identity. An anchor that can't be resolved falls back to the end. The view is hidden until rows settle, with a 2.5 s default deadline. [glass.js:424132–424137, 574279, 477134–477139, 477112]
- **History.** Cloud chats page earlier turns while the top is within two viewport heights. [glass.js:337605–337607, 503951–503956]
- **Unread state machine.** Every rule in spec §5. [glass.js:679090–679474, 683921–683943, 192337–192348, 208108, 498744]
- **Summaries.** Lane merge for the default "compact-all-grouped" density. A single tool call renders alone. Groups split at 200 items. Live verbs keep their counts, except for thinking. Counts are per call: two reads of one file count as 2. Searches are their own bucket. Failed calls are not filtered out. [glass.js:28927, 191603–191715, 176238–176290, 186425–186600, 192460–192610]
- **Blocks.** "Ln a–b" shows only when both line numbers are positive. The whole header is the button. Both copy confirmations last 2 s. Relative time reads "Just now", then m/h/d/mo/y with "ago". [glass.js:110019–110058, 110009, 185909, 194548–194556]
- **Inline subagent link.** Text rule: the authored text, unless it's empty or the bare ID. Activation opens the subagent preview first and falls back to the agent. [glass.js:471508–471512, 783439]

## Fixes to the Nyte comparisons

| Report row | Was | Is |
|---|---|---|
| 11: Follow versus reading | Three explicit states | Two modes, following and reading. "Held" is an event. Nyte transcript-mode.ts:9–53. |
| 11: Geometry-aware cached heights | A 16-entry cache "keys session/pane" | Correct, but the cache stores whole virtualizer snapshots in memory and doesn't key them by width, font or density. A snapshot taken at another width is reused as is. Nyte transcript.tsx:53–55, 233, 518–524. |
| 11: Scroll save/restore | Keep | Keep, with one fix: when the saved anchor row is gone, Nyte opens in reading mode near the estimated end instead of following the end. Glass falls back to following the end. Nyte transcript.tsx:258–264, 472–484; transcript-mode.ts:24–31. |
| 11 / 01: Bottom thresholds | "1 px follow vs 60 px button" | Correct (transcript.tsx:346; transcript-scroll.ts:63). Nyte releases on any wheel, touch move, scrollbar press or navigation key, upward or not, and re-follows when a scroll lands at the end (transcript.tsx:657–686). Glass releases only on upward movement. |
| 01: Persisted unread boundary | Absent → drop | The seen mark exists and is persisted. See C5. |
| 01: Explicit return to following | Blurs instead of focusing the composer | Correct (transcript.tsx:755–758). Glass's plain arrow focuses the prompt (glass.js:684282–684283). |
| 06: Live header without counts | change | Confirmed (step-group.tsx:275–285). |
| 06: Finished totals deduplicate and drop failures | change | Confirmed (step-group-presentation.ts:78–127). The spec keeps Nyte's unique-path counting and adds a search bucket. That's a deliberate improvement, not parity. |
| 07: Code-copy confirmation | Persists while the code is unchanged | Confirmed (code-block.tsx:137–138, 176–180). |
| 07: Reply actions | Absent | Confirmed: ResponseView renders only prose (turn-view.tsx:646–651). |
| 05: Inline child citation | keep | Keep and add the working glyph. See C12. |
| Legend branch (brief) | Deletes the mode machine and the size cache | Also deletes the per-kind estimates and uses one 120 px estimate for every row. It relies on the library's end-maintenance, content-position maintenance and sticky headers, and carries a 360-line patch against the library's built files touching five internals: user-scroll timing, always-render break index, container-order tracking, the web shrink deferral (disabled) and DOM re-ordering. [legend-transcript worktree: transcript.tsx:32–43, 286–318; transcript-rows.ts diff; patches/@legendapp__list@3.7.0.patch] |

## Runtime-only questions (phrase each as a check)

1. In Glass, scroll up 200 px during a streamed reply. Check that the view stays put and that the down pill appears only when a new assistant message (a new identity) gets text, not while the current one grows.
2. Open a chat with three unread replies, starting at the end. Check that "↑ 3 New Messages" shows, that clicking it puts the divider about a third of the way down the viewport, and that the jump is instant.
3. After step 2, scroll to the end. Check that the "New" divider stays. Switch to another chat and back, and check that it's gone.
4. Leave the window unfocused while two replies arrive in the open chat, then refocus. Check that a divider appears before the first of them and that the sidebar unread mark clears on focus.
5. Check the pill's position and size against the static reading: 12 px below the transcript top, centred on the column, 28 px tall. Check for both directions.
6. Press × on the down pill. Check that nothing scrolls and that the plain scroll-to-bottom arrow stays visible.
7. Finish a turn you watched. Check whether its "Worked for …" group stays expanded. Reopen the chat after a restart and check whether that group is collapsed.
8. Restart Glass, then reopen a long chat that was last read in the middle. Check that it opens at the end: scroll position is not persisted, but heights are.
9. Check whether rows reflow visibly on first open after a restart compared with a second open (the disk height cache).
10. Single-line citation: check whether the card shows "Ln 16–16" or no range.
11. Check whether the live "Exploring" label shows an ellipsis or a shimmer. The code has neither.
12. Screen reader: check what's announced when the pill appears. The pill sets no live region.
