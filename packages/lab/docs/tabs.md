# Tabs

Window tabs for the desktop app. Each tab is a saved place: you open a PR
review, start a new chat, and switch straight back to the review. The sidebar
keeps working as a full list of chats. Tabs hold the places you want to return
to.

Prototype: `packages/lab/src/tabs/` (`/tabs` in the lab). References: Linear's
desktop app for layout, tooltip and tab menu; opencode `v2`
(`packages/app/src/shell/tabs`, `shell/titlebar`) for shortcuts and dragging.

## Scope

- Desktop only. The web app has no tab strip. It keeps showing whatever its
  URL points to, uses the browser's back button and keeps splits as today.
- Tabs launch with the places that exist now: new chat, chat, Customize and
  Environments. Review joins once its page leaves the lab.

## Places

| place | in a pane | fills the tab | notes |
| --- | --- | --- | --- |
| new chat | yes | | starts in the focused chat's folder, or the last folder used |
| chat | yes | | |
| review | yes | | Overview / Guide / Diff replace the entry; they add no back step |
| Customize | | yes | can't be split |
| Environments | | yes | can't be split |
| Settings | | | outside tabs: covers the whole window and hides the strip |

A tab shows either one full-tab page or panes: one, or a split of two. Its
split and history are saved with it. Splitting or closing a pane is not a
navigation step.

## Sidebar

The sidebar doesn't change. Its grouping and filters are separate from tabs,
and the strip isn't tied to any folder.

- A plain click opens the place in the focused pane of the current tab.
- ⌘-click or middle-click opens it in a background tab. ⌘⇧-click opens it and
  switches to it.
- New Chat opens the composer in the focused pane, the same as ⌘N.
- If the other half of the split already shows that page, it just gets focus.
- Dragging a chat into a pane still splits it, as today.

## Strip

- Tabs sit in the titlebar row, after back/forward. There's no breadcrumb.
  The main area is a card set into the chrome below the strip.
- A tab shows its status icon (working, waiting, failed), its title, a split
  icon when split, and a close button on hover or when active. A dot appears
  when a chat in a background tab finishes.
- Hovering a tab shows its title and its ⌘1–9 shortcut. Each keycap lights up
  while that key is held.
- The right-click menu has New tab (⌘T) and Duplicate tab, then
  Close tab (⌘W), Close other tabs and Close tabs to the right.

## Closing

When the active tab closes, the tab to its right takes over, then the one to
its left. If none is left, a new chat tab opens. There is no Home or overview page behind the
strip.

## History

History is per tab. Each pane keeps its own entries, and the tab keeps the
views it moved between.

- Back goes back in the focused pane first, then through the tab's earlier
  views. An unsplit tab therefore behaves like one list.
- Going from a split to Customize and pressing Back brings back the exact
  split.
- Background tabs aren't kept rendered. Every entry remembers its scroll
  position and restores it. Running chats keep updating either way.
- Tabs and the reopen list survive a restart, saved per window.

## Workbench

The workbench follows the focused chat's folder. Switching tabs, or switching
between split panes from different folders, switches it. It stays hidden on
full-tab pages, as it is on Customize and Environments today.

## Shortcuts (opencode)

| keys | action |
| --- | --- |
| ⌘N | new chat in the focused pane |
| ⌘T | new tab |
| ⌘W | close tab (see Closing) |
| ⌘⇧T | reopen the last closed tab (keeps 25; skips empty new chats) |
| ⌘1 … ⌘9 | tab 1 … 9 (⌘9 is the ninth tab, not the last) |
| ⌃Tab, ⌃⇧Tab, ⌘⌥→, ⌘⌥← | next / previous tab, wrapping |
| ⌘[, ⌘] | back / forward in the tab |

## Dragging (opencode)

Only reordering within the strip:

- A drag starts after 4px of movement (8px on touch), and picking a tab up
  selects it.
- The tab moves only sideways and stays inside the strip, which scrolls when
  you drag near its edge.
- Pressing the close button never starts a drag. Escape cancels.
- The tab drops in place without animating. Neighbours slide aside once the
  dragged tab's leading edge passes their centre.

No dragging tabs out to a new window, and no dropping a tab into a pane.
Nothing in the sidebar can be reordered by dragging; its filters decide the
order. Dragging a chat from the sidebar into a pane still works.

## Agreed alongside

These don't depend on tabs and can ship first.

- **File tree → message box.** Dropping a file from the file tree on the
  message box inserts an `@path` mention, the same as picking it after typing
  @. A folder becomes a folder mention. The drag only carries the path: you
  can't move files inside the tree or drop a file on a pane or tab. The tree
  (`@pierre/trees`) can already drag; `workbench/file-tree.tsx` doesn't turn
  it on, and the message box only accepts files dropped from the Mac.
- **Workbench and terminal tabs reorder** with the same drag rules as window
  tabs, built on `@dnd-kit/core`.
- **Queued messages don't reorder.** You edit, cancel or steer them, as today.
- **Steer is the default** for a message sent during a run, on every client.
  Core sets it: `messages.send` without a `delivery` steers while the head
  has a live run and uses `next` otherwise. Desktop and web default to steer
  (anyone who chose Queue in Settings keeps it). The terminal client already
  steered. Mobile steers by default; holding Send during a run offers Queue
  Message, also available to VoiceOver as a "Queue message" action.
