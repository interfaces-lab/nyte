# Spec

What Nyte Studio does, the budgets it is held to, and how each was measured. [Design](DESIGN.md) holds the reasons, [motion](MOTION.md) the moving parts, [benchmark](BENCHMARK.md) the measurements.

## Scope

| Release | Scope                                                                                       |
| ------- | ------------------------------------------------------------------------------------------- |
| Now     | macOS 26, one window, one project, the canvas, the inspector, the chat, zen, the `lune` command |
| Later   | Drawing tools, component variants, tool input streamed from the host, signing and updates   |

Studio owns no agent. Quitting it stops nothing: chats run in the host and are in Nyte too.

## Canvas

| ID  | Behaviour                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------- |
| C01 | Every `.lune` file in the project is on one canvas. Choosing a file moves the camera. It never swaps a document   |
| C02 | A frame is redrawn only when its file's layout changed. A file with an error keeps its last good frames, marked   |
| C03 | Bitmap memory follows the size of the view, not the zoom or the number of frames. See the three tiers below       |
| C04 | Frames are drawn off the main thread, at most half the cores at a time. A request that is out of date is cancelled before it draws |
| C05 | A pan, a zoom or a frame of a flight sets one transform on the designs and moves the labels. Frames are laid out again, on whole pixels, when the camera rests |
| C06 | Elements nest at most 128 deep, in a file and again once components are expanded. Deeper is an error in that file |
| C07 | A shadow blurred wider than 16 device pixels is blurred at a fraction of the scale and stretched. It is within four levels of the full-size blur for 99.9% of pixels, and no shadow leaves a dark fringe on the edge of its shape |
| C08 | A click selects the deepest box the sheet's own file writes; an instance of a component is one box. A double click selects the part of the instance under the pointer, and clicks then select parts. Command-click selects the deepest box from anywhere. Esc steps out one level, from a component's root to its instance |
| C09 | An edit to a selection inside a component is written to the component's file. While the selection is inside one, the canvas names it and counts its instances |
| C10 | A double click on text selects it and puts the caret in its words in the inspector, selected, as the file writes them |
| C11 | The middle button pans. Keys for letters and punctuation are matched by what they type. Space held when the canvas loses the keyboard is released |
| C12 | A file gets a place on the canvas when it first has frames and keeps it, between launches too. Nothing moves because another file changed, grew or had a frame dragged in it. A file is labelled with its name, not its path |

The three tiers of C03:

| Tier      | Who has it                 | Size                                                    |
| --------- | -------------------------- | ------------------------------------------------------- |
| Thumbnail | Every frame                | 16,384 pixels, about 64 KB                              |
| Base      | A frame in or near view    | The whole frame at the screen's scale, up to 1 megapixel |
| Tile      | A frame whose base is coarser than the screen | The part in view, plus 64 points around it, at the exact scale |

Bitmaps are `IOSurface`s, so a layer shows the only copy of its pixels. A surface a layer stops showing is marked volatile half a second later.

## Editing

| ID  | Behaviour                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------ |
| E01 | A drag, a resize or an inspector field rewrites only the bytes of the value it changes                       |
| E02 | A write names the version it expects. A stale write is refused, the outside version is shown, and a notice says the edit was dropped |
| E03 | Undo puts a file's text back only when the file still holds the text the edit left. An outside change drops that file's undo steps |
| E04 | An attribute value is escaped for both quotes. Replacing text replaces all of it, line breaks included, and opens a self-closed element |
| E05 | An edit lays out the file it changed and the files that use it. Every other file keeps its layout            |
| E06 | A field writes on Return or when it loses focus, never on each keystroke                                      |
| E07 | A value with a few fixed answers is a row of choices and one with many is a menu; neither is typed. A choice or a switch writes at once. The arrows step a number, by ten with Shift, and a drag on its symbol changes it with the canvas following, as one undo |
| E08 | Direction turns a `col` into a `row` or a `box` by renaming its tags, and sets `layout` on a frame. Padding is two fields, or four when the sides differ, written in the shortest form that says them |

## Agent

| ID  | Behaviour                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------- |
| A01 | A chat started in Studio is a session on the host, with the Lune guide as a prompt layer                        |
| A02 | The selection goes with a message as an excerpt: its file, its lines and its markup                             |
| A03 | While a turn runs, moonlight surrounds the frame the agent was asked about and the frames of every file a step of the turn has touched. It stays 1.5 s after the turn ends |
| A04 | A change from outside lights each frame it changed for 1.5 s. A new file's frames are lit as they arrive          |
| A05 | Other clients can ask Studio to `reveal` a file or a frame and to `snapshot` a frame. A snapshot is drawn and encoded off the main thread |
| A06 | The agent panel names, in words, the host and whether it is connected, each provider it is signed in to, and whether the project has the Lune skill, with the one action each allows |
| A07 | Without the host the composer says "Reconnecting to Nyte…", keeps what was typed and can't send. The canvas keeps the designs as they last were |
| A08 | A chat's row says whether it is working, waiting for an answer or stopped on an error. Each has its own mark and its own words |
| A09 | The composer is at the foot of the Chat tab. While a turn runs and nothing is typed, its send button stops the turn. With the chat off screen, in zen or with the panel away, a dock floats at the foot of the canvas instead and says one thing above its composer: a notice for 5 s; else the turn in progress with a stop button; else the last word of the turn that just ended, or the error it stopped on |
| A10 | In the dock the last word shows up to four lines, with a button to the whole chat. A turn that ends while the chat is out of view puts a badge on the Design or Chat switch until the chat is shown |
| A11 | A turn that is waiting for an answer says so and offers Answer in Nyte                                           |
| A12 | A read of the chats that fails, and a stop that fails, raise a notice. A connection the host won't send events on is dropped and tried again, and the agent panel says why it is reconnecting |
| A13 | The chat draws Markdown: headings, lists with hanging indents, task lists, quotes, tables, links and bare addresses, inline code, fenced code in a box with its language and a copy button, and a `mermaid` fence as a diagram in the app's colours once its source stops arriving. A source that does not parse stays code |
| A14 | What a person sent is a bubble at the trailing edge, as wide as its words up to most of the column, cut at eight lines with a way to the rest. The steps between two things the agent said are one line that opens: each kind of step with its count, the lines changed, and how many failed |

## Window

| ID  | Behaviour                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------ |
| W01 | The window has one toolbar row, on the line of its own buttons. Tracking separators keep each group over its column: the sidebar's toggle; the project, day or night, zoom and zen; Design or Chat and the inspector's toggle. It fits at the smallest window without an overflow menu. With the inspector away, Design or Chat folds into a menu, and choosing from it opens the inspector |
| W02 | The sidebar and the panel start right under the toolbar, so their first lines are level. A reply that ends while the chat is out of view puts a badge on Design or Chat until the chat is shown |
| W03 | Zen puts away the toolbar and both sides, and the canvas runs edge to edge. The traffic lights fade and come back under the pointer. A toast at the bottom centre says how to ask and how to leave. The composer stays away until `/` or ⌘K summons it. What zen collapses is not saved |
| W04 | Every gap, inset, control height, radius, symbol size and type size in the app comes from a token or a named metric. `check:layout` fails the build on a bare number |
| W05 | The smallest window is 1080 by 580 points                                                                    |
| W06 | A side toggled from the keyboard is there or gone at once. Toggled from a control it slides                   |

## `lune`

| ID  | Behaviour                                                                                          |
| --- | -------------------------------------------------------------------------------------------------- |
| L01 | `check` exits non-zero for a file it can't read, a parse error, a missing dependency or a warning   |
| L02 | `render` draws and writes one frame at a time                                                       |
| L03 | The same file renders to the same bytes every time                                                  |
| L04 | A number is finite and at most 100000 either way. `nan`, `inf`, `1e999` and anything larger read as if the attribute were not written |
| L05 | `render` refuses a frame that would take more than 100 megapixels, and says its size                |

## Budgets

Release build, Mac16,8 (M4 Pro, 12 cores, 24 GB), macOS 27.3, a 60 Hz 5K display, window 1440 by 900 with both sides open, the Tide sample project. Timing is the median of the runs given.

| Path                                               | Budget                       | Measured                                   | Sample                       |
| -------------------------------------------------- | ---------------------------- | ------------------------------------------ | ---------------------------- |
| App bundle                                         | ≤ 10 MB                      | 2.7 MB                                     | `du -sk`                     |
| Processes                                          | 1                            | 1, with 4 threads at idle                  | 30 s                         |
| Footprint at idle                                  | ≤ 60 MB                      | 42 to 49 MB                                | 4 launches                   |
| Footprint at zoom 2                                | ≤ 100 MB                     | 73 to 88 MB                                | 3 runs                       |
| Footprint with 200 more phone frames, zoom 1 and 2 | ≤ 1 MB per frame             | 135 and 170 MB, 0.3 and 0.4 MB per frame   | 1 run each                   |
| Footprint back at fit after zooming                | idle + 10 MB                 | idle + 2 to 10 MB                          | 9 round trips                |
| The same on the reviewers' sweep, which also selects, pans and resizes | idle + 10 MB | idle + 9 to 17 MB. Misses the budget       | 3 runs                       |
| Footprint after 50 cycles of zen, edit, undo and zoom | no growth after the first 5 | cycles 5 to 9 at 65.5 MB, 46 to 50 at 51.2 MB, 44.4 MB ten seconds later | 1 run |
| Render server while frames are lit                 | report                       | 8% of a core more for one frame, 2% more for each further one, none in the app | 12 s each |
| CPU at idle                                        | ≤ 0.5%                       | 0.045%                                     | 30 s                         |
| `open` to first window, warm                       | ≤ 400 ms                     | 232 ms, 215 to 239                         | 8 launches                   |
| Flight, intervals within 1.5 refreshes             | ≥ 99%, none over 3           | 100%, longest 16.8 ms                      | 182 intervals, 7 flights     |
| The same with 200 more frames                      | ≥ 99%, none over 3           | 100%, longest 19.2 ms                      | 182 intervals, 7 flights     |
| Drag with 200 more frames, longest stall           | ≤ 50 ms                      | 33 ms                                      | 66 intervals                 |
| Speed kept when a flight is redirected             | no restart from rest         | lowest frame-to-frame ratio 0.77           | 4 redirects                  |
| Controls off the control heights                   | 0                            | 0 of 46                                    | 4 states                     |
| Gaps off the spacing scale                         | 0                            | 0 of 115                                   | 4 states                     |
| Pointer targets under 24 points                    | 0                            | 0                                          | 4 states                     |
| Text contrast                                      | ≥ 4.5 to 1, icons ≥ 3 to 1   | lowest text pair 5.45 to 1, lowest icon 3.89 | 38 role pairs, light and dark |

The miss is free memory the allocator holds on to after Core Graphics draws at a high scale. It is reused by the next drawing, it does not grow, and fifty cycles later the footprint is back within 2 MB of idle. [Benchmark](BENCHMARK.md) has the breakdown.

## Acceptance

| ID   | Scenario                                              | Pass                                                             | Result              |
| ---- | ----------------------------------------------------- | ---------------------------------------------------------------- | ------------------- |
| X01  | Edit a fill, an agent edits the same file, press Undo  | Both the agent's change and the fill are still in the file        | Pass, 1 of 1        |
| X02  | A file changes underneath a pending edit               | The write is refused and the file is the outside version          | Pass, 1 of 1        |
| X03  | Set a value holding `'` on a single-quoted attribute   | The file parses and the value reads back                          | Pass, 240 of 240    |
| X04  | Replace text that holds `<br/>` or a comment           | The element reads exactly the new text                            | Pass, 8 of 8        |
| X05  | A file nested 2,000 deep is in the project             | The app runs, the file is marked broken, `lune check` exits 1      | Pass                |
| X06  | Quit in zen, launch again                              | Both sides are where they were before zen                         | Pass, 1 of 1        |
| X07  | Stop the host, start it again with the same project and chats | The app stays up and says why it is reconnecting. Attached again, the same chat takes a message and a file edited on disk reaches the canvas | Pass, 1 of 1 |
| X08  | 50 cycles of zen, an edit, its undo and a zoom round trip | No growth after the first five                                 | Pass: 65.5 MB then 51.2 MB |
| X09  | Mutate the sample files 2,500 times and check each, 2,000 times and render each | No crash, none over 5 s                  | Pass: 0 and 0, longest 0.06 s |
| X10  | Render 3,000 frames whose numbers are at their limits  | No crash, none over 10 s                                          | Pass: 0 and 0, longest 1.6 s. Before L04 and L05, 85 of 1,500 never finished |
| X11  | The whole journey under Thread Sanitizer: two turns, zooms, drags, undo, zen, both sides | 0 reports                        | Pass, 0             |
| X12  | Build in the Swift 6 language mode                     | No error, no warning                                              | Pass                |
