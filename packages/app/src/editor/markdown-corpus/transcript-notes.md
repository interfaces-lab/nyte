# Transcript movement

How the chat transcript moves. `transcript-mode.ts` decides the mode from rules 1–8, `transcript.tsx` moves the view, and the Electron harness checks them every frame. A change to how the transcript scrolls changes this file first.

## Modes

The transcript is always in one of two modes.

- **Following.** The view sits at the real end and moves down as content arrives. "At the end" means within 1px of the bottom.
- **Reading.** The view holds an anchor: an element and its distance from the top of the scrollport. Nothing that arrives, grows, shrinks, or re-measures moves the anchor on screen.

## Entering Following

1. Opening a session that was left at the end.
2. Sending a message.
3. Clicking scroll-to-bottom.
4. The reader scrolling to the real end.

## Entering Reading

5. Wheel up, dragging the scrollbar up, or ↑, PageUp, Home, or Shift+Space outside an editor.
6. Expanding or collapsing anything in the transcript. The anchor is the control that was clicked.
7. Starting to edit an earlier message. The anchor is that message.
8. Selecting text in the transcript. The anchor is the row holding the selection.

Only the reader moves Reading back to Following, through rules 3 and 4. Saving or cancelling an edit, collapsing a group, or clearing a selection leaves the transcript in Reading.

## While Reading

9. Content growing below the anchor, such as a streaming reply, does not move the view.
10. Rows above the anchor that change size, whether on first measure, collapse, or re-measure, are compensated so the anchor stays put.
11. The anchor keeps its screen position while it expands or collapses. It grows downward.
12. While editing, the editor's top stays fixed on screen. Streaming elsewhere never moves it.

## Composer

13. The composer is docked to the bottom of the conversation column and never moves with content. No transcript content is visible below it.
14. The last row ends a fixed gap of 114px above the composer.
15. When the composer's height changes, because a tray opens or the draft grows, Following stays at the end and Reading keeps its anchor.

## Sticky prompts

16. The prompt of the turn being read sticks to the top.
17. Following sticks prompts the same way Reading does: the latest prompt stays at the top until its turn ends, even at the end of the chat. Sending, streaming, or a turn ending never makes a prompt jump on or off the top.
18. A prompt taller than the viewport never sticks.

## Row identity

19. A row keeps its identity, its DOM, and its position through every change to its content. That covers a prompt or steered message joining its turn, a continuation folding into the previous row, a commit replacing live parts, and streamed text arriving.

The latest turn owns one summary row keyed by its prompt. It reserves the height of a full Files Changed card while pending, so the card appearing, or no changes at all, never changes its height. A new normal prompt replaces the previous turn's summary reservation.

## Restore and resize

20. Each pane remembers each session's position. A session left at the end reopens at the end. Otherwise it reopens with the same anchor row at the same offset within it.
21. On window or pane resize, Following stays at the end and Reading keeps its anchor.

## Always

22. Rows never overlap or leave the visible range unrendered on a painted frame. Scroll adjustments and the rows they reveal commit together.
23. The transcript's extent is never less than the last row's bottom on a painted frame.
24. Remounting paints the same picture. If a reload changes what the reader sees, one of these rules was broken.

## Details

25. Scroll-to-bottom shows when the view is more than 60px from the end.
26. A live step-group preview follows its own tail. It pauses when the reader scrolls inside it and resumes after 10s or once the reader reaches its end.
27. Older messages load a page at a time while the view is within three screen heights of the top. Pages keep loading until the view leaves that range or the first message shows. Loading them never moves the view.

## Open decisions

These follow the current behavior until decided.

- Rule 2: sending follows the end. The alternative pins the new prompt to the top with empty space below it.
- Rules 7 and 8 end in Reading. The alternative returns to Following when the edit closes or the selection clears while the end is in view.
- Rule 8 is new. Without it, a reply streaming in while the reader drags a selection moves the text under the pointer.
