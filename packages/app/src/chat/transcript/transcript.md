# Transcript movement

How the chat transcript scrolls. `transcript-mode.ts` decides the mode, and `transcript.tsx` moves the view. `transcript-frames.test.ts` checks these rules across painted frames in an Electron renderer. When you change how the transcript scrolls, change this file first.

## Modes

The transcript is always in one of two modes, Following or Reading.

In Following, the view sits at the end and moves down as content arrives. It stays within 1px of the bottom. When the view enters Following, anything within 4px of the bottom counts as the end, because fractional offsets at non-integer zoom can leave a few pixels.

In Reading, the view holds its place. Rules 6, 7 and 8 give it an anchor, which is an element and its distance from the top of the view. Nothing that arrives, grows, shrinks or re-measures moves the anchor on screen. When the reader's own scrolling starts Reading, there is no anchor. The view keeps its scroll position instead, and rows above it that change size are compensated.

## Entering Following

1. Opening a session that was left at the end, or that this pane hasn't shown before.
2. Sending a message, including saving a queued message you edited in the composer.
3. Clicking scroll-to-bottom. This also focuses the composer.
4. Reaching the end while Reading has no anchor. The reader's own scroll input drops any anchor first, so scrolling to the end always follows.

## Entering Reading

5. The reader scrolling up. That covers the wheel, touch, dragging the scrollbar, and ↑, PageUp, Home or Shift+Space outside an editor. PageUp in a full chat's composer also counts. Any other upward scroll that leaves the view more than 4px from the end starts Reading too, once the session has finished opening. Content shrinking under the view doesn't count.
6. Clicking a control that expands or collapses, which is anything with `aria-expanded`, or clicking inside a live step-group preview. The anchor is the clicked element.
7. Starting to edit an earlier message. The anchor is that message's row.
8. Selecting text in the transcript. The anchor is the row where the selection starts.

Reading returns to Following only through rules 2, 3 and 4. Saving or cancelling an edit of an earlier message, collapsing a group, or clearing a selection leaves the transcript in Reading.

## While Reading

9. Content growing below the anchor, such as a streaming reply, doesn't move the view.
10. The view compensates for rows above the anchor that change size, on first measure, collapse or re-measure, so the anchor stays put.
11. The anchor keeps its screen position while it expands or collapses. It grows downward.
12. While you edit a message, its row stays fixed on screen. It stays rendered even after it scrolls out of the rendered window. Streaming elsewhere never moves it.

## Composer

13. The composer is docked to the bottom of the conversation column and never moves with content. The transcript fades out above the composer, so no transcript content shows below its top edge.
14. At the end, 114px separate the last row from the top of the composer, or 17% of the room above the composer, rounded down to the 2px grid, when that is less. The room is the Messages view's height minus the composer's.
15. When the composer's height changes, because a tray opens or the draft grows, Following stays at the end and Reading keeps its anchor.

## Sticky prompts

16. The prompt of the turn being read sticks to the top of the view. Reports from agents and jobs, and late answers to questions, don't stick.
17. Following sticks prompts the same way Reading does. A prompt stays stuck until the last row of its turn scrolls past it, even at the end of the chat. Sending, streaming or a turn ending never makes a prompt jump on or off the top.
18. A prompt as tall as the view, or taller, never sticks.

## Row identity

19. A row keeps its identity, its DOM and its position through every change to its content. That covers a prompt or steered message joining its turn, a continuation folding into the previous row, a commit replacing live parts, and streamed text arriving.

The latest turn owns one summary row, keyed by its prompt. While the turn runs, the row reserves the height of a full Files Changed card, so the card can arrive without moving the transcript. The reservation leaves the Messages view's first 320px to the conversation, so a view under 320px tall reserves nothing and a taller one reserves at most its height minus 320px. After the turn ends, the row holds the card if there are changes and is empty if there are none. A card taller than the reservation grows the row, and Following keeps the end in view. A prompt that opens its own turn moves the summary row to that turn. A prompt that joins a running turn doesn't.

## Restore and resize

20. Each pane remembers each session's position. A session left in Following reopens at the end. Otherwise it reopens with the same row at the same distance from the top of the view. That row is the anchor, or the top visible row when there is no anchor.
21. On window or pane resize, Following stays at the end and Reading keeps its anchor.

## Always

22. Rows never overlap or leave the visible range unrendered on a painted frame. Scroll adjustments and the rows they reveal commit together.
23. The transcript's extent is never less than the last row's bottom on a painted frame.
24. Remounting paints the same picture. If a reload changes what the reader sees, one of these rules was broken.

## Details

25. Scroll-to-bottom shows when the view is more than 60px from the end.
26. A live step-group preview follows its own tail. It pauses when the reader scrolls up inside it, and resumes once the reader scrolls back to its end.
27. Older messages load a page at a time while the view is within three screen heights of the top. Pages keep loading until the view leaves that range or no older messages remain. A session that opens at the end loads nothing older until it has settled there. Loading never moves the view.

## Open decisions

The current behavior holds until these are decided.

- Rule 2 follows the end on send. The alternative pins the new prompt to the top with empty space below it.
- Rules 7 and 8 end in Reading. The alternative returns to Following when the edit closes or the selection clears while the end is in view.
- Rule 8 is still on trial. Without it, a reply that streams in while the reader drags a selection moves the text under the pointer.
