# Benchmark

Two reviewers, Claude Opus 5.5 and GPT-6.1 Sol, measured the same build on the same brief without seeing each other's work. The brief allowed no finding that rested on how the app looks. Each needed a number, the bar it was held to, the command that produced it, and the line of code that caused it. The fixes came after, and the numbers on the right were taken with the reviewers' own scripts on the fixed build.

Machine: Mac16,8, M4 Pro, 12 cores, 24 GB, macOS 27.3, one 60 Hz 5K display. Release builds. Window 1440 by 900 with both sides open. The Tide sample project, and the same project with 200 phone frames added.

## Where the reviewers agreed

Both found the same six things first: undo erasing an outside edit, the patcher writing a file that no longer parsed, memory growing with the square of the zoom, a redirected flight restarting from rest, controls and gaps off the scales, and zen's collapsed sides surviving a quit. Their numbers for the shared measurements were within noise of each other.

| Measurement | Opus | Sol |
| --- | --- | --- |
| Bundle | 3.43 MB | 3.59 MB |
| Idle footprint | 46.1 to 52.2 MB | 47.2 MB |
| Footprint at zoom 2 | 179 MB | 208 MB |
| Idle CPU | 0.035% | 0.033% |
| Warm launch, median | 313 ms | 290 ms |
| Flight intervals within 1.5 refreshes | 97.7% | 98.9% |
| Speed kept across a redirect | 0.05 to 0.18 | 0.09 to 0.36 |
| Attribute patches that broke the file | 27 of 14,818 | 12 of 240 |

Opus alone found the crash on deep nesting, the 2.3 GB with 200 frames, the per-event relayout on a drag, and that a third of the bundle was symbols. Sol alone found the snapshot drawn on the main thread and `lune check` passing a file that doesn't exist.

## Before and after

| Metric | Bar | Before | After |
| --- | --- | --- | --- |
| Bundle | ≤ 10 MB | 3.43 MB | 2.7 MB |
| Idle footprint | ≤ 60 MB | 46 to 52 MB | 42 to 49 MB |
| Footprint at zoom 2 | report | 179 to 208 MB | 73 to 88 MB |
| Footprint, 200 more frames, zoom 1 | ≤ 1 MB a frame | 2,322 MB | 135 MB |
| Footprint, 200 more frames, zoom 2 | ≤ 1 MB a frame | 2,468 MB | 170 MB |
| Threads at the peak, 200 more frames | report | 70 | 20 |
| Footprint back at fit after zooming | idle + 10 MB | idle + 4 to 17 MB | idle + 9 to 17 MB on the sweep, idle + 2 to 10 MB for the round trip alone |
| Idle CPU | ≤ 0.5% | 0.035% | 0.045% |
| Warm launch, median | ≤ 400 ms | 313 ms | 232 ms |
| Flight intervals within 1.5 refreshes | ≥ 99% | 95.6 to 98.9% | 100% |
| The same, 200 more frames | ≥ 99% | 84.6% | 100% |
| Longest stall in a flight | ≤ 50 ms | 227 ms | 16.8 ms |
| Longest stall dragging, 200 more frames | ≤ 50 ms | 109 ms, once 951 ms | 33 ms |
| Speed kept across a redirect | no restart | 0.05 to 0.36 of the speed | no drop: 5.7 then 6.7 per second |
| Undo after an outside edit | outside version survives | lost in 3 of 3 | kept in 1 of 1 |
| Attribute patches, parse and read back | 0 failures | 27 of 14,818, 12 of 240 | 0 of 240 |
| Text replaced across a line break | 0 failures | 117 of 14,818, 2 of 3 | 0 of 8 |
| A file nested 2,000 deep | no crash | crash on every launch | an error in that file |
| `lune check` on a missing file | exit non-zero | exit 0 | exit 1 |
| Quit in zen, launch again | sides as before zen | both collapsed | both shown |
| Controls off the control heights | 0 | 18 to 19 | 0 of 46 |
| Gaps off the spacing scale | 0 | 16 to 22 | 0 of 115 |
| Pointer targets under 24 points | 0 | 16 to 17 | 0 |
| Inspector field left edges | 1 per column | 11 | 1 |
| Text contrast under 4.5 to 1 | 0 | 4 pairs, 3.67 to 4.11 | 0 of 32 text pairs, lowest 5.45 |
| Animations on a curve other than the declared one | 0 | 4 of 10 | 0 of 8 |
| Keyboard shortcuts that move something | 0 | 7 | 0. Zen still fades for 150 ms |
| Reduce Motion | fades kept | every fade cut | fades kept, by reading the code |

Gaps and control sizes are now measured on alignment rectangles, which is what Auto Layout places and the eye lines up. The reviewers measured frames. A symbol in an image view has a frame up to 2.5 points wider than its alignment rectangle, so a frame-based count reports gaps of 3.5 and 5.5 that are 6 and 8.

The spacing scale the reviewers were given was 4, 8, 12, 16, 20, 24. Nyte's own scale also has 1, 2, 6, 10 and 32, and the after column uses it.

## What still misses

**Memory after the reviewers' sweep.** Zooming to 2, selecting, zooming back, then panning and resizing leaves the footprint 9 to 17 MB above idle, against a bar of 10. It was 15 to 36. A zoom round trip on its own leaves 2 to 10 MB and passes.

None of it is live. It is free memory the allocator keeps after Core Graphics has drawn at four or eight pixels a point. A harness that draws the sample's frames the way the canvas draws a tile, with each kind of drawing switched off in turn, puts numbers on where it comes from:

| Drawing at eight pixels a point | Kept afterwards |
| --- | --- |
| Everything, before | 17.7 MB |
| Everything, now | 13.1 MB |
| Without shadows | 10 to 11 MB |
| Without shadows, path clips, text and icons | 5 to 6 MB |

Shadows were 8 MB of it and are now 2. Each one was blurred at full scale and clipped to a path, so it took buffers the size of everything in view. A wide blur is now drawn into a small mask and stretched, and under a fill that hides it the shadow is not cut out of its shape, which spares the path clip. The rest is glyphs at large sizes, clips to rounded shapes and gradient fills, and it is the same at any zoom past four pixels a point.

It does not accumulate. Fifty cycles of zen, an edit, its undo and a zoom round trip end 14 MB lower than they began, and ten seconds later the footprint is 1.5 MB above where the app started.

## What was re-measured, and what it found

Every item the first pass left open was run on the final build, with the reviewers' scripts where they had one.

| Check | Result |
| --- | --- |
| Stop the host and start it again | Passes. The chat is still there, takes a second message, and a file edited on disk afterwards reaches the canvas. The test host can now keep its project and chats between runs, which is what made this measurable |
| 50 cycles | No growth |
| 2,500 checks and 2,000 renders of mutated files | 0 crashes, 0 over 5 s, longest 0.06 s |
| Thread Sanitizer over the whole journey | 0 reports |
| Each chrome fade against its declared curve | 8 of 8 on `outQuint` at the declared duration |
| Swift 6 language mode | Builds with no error and no warning. The package is now in that mode |

Two of these found bugs the first pass had not.

**A frame with a number at its limit hung the renderer.** Mutating bytes never produced one, so the fuzz passed. Generating frames with `nan`, `inf`, `1e999` and a padding of 50000 did: 85 of 1,500 renders never finished, and the reviewers' own build hung on the same files. A padding of 50000 makes a frame 100,000 points square, which is 40,000 megapixels to draw. A number must now be finite and at most 100000, and a frame over 100 megapixels is refused with its size. 3,000 such renders finish, the longest in 1.6 s.

**The first fade of a view was a pop.** The zen hint and the canvas controls appeared at full opacity the first time, because a view that had never been faded out still carried an opacity of 1 and its fade ran from 1 to 1. Sampling the hint's opacity on each refresh showed one step instead of a curve.

Screenshots are back. The app is captured from inside its own process, which needs no screen-recording permission, so the layout was looked at in light and dark and not only measured. That is how a sidebar count sitting 18 points off the row's edge and a composer left a third of its width after zen were found.

## Not measured

Reduce Motion with the setting on: it needs the system setting changed. Tab order and VoiceOver: they need the window in front, and every run here kept it behind the others. Cold launch. Frames as the window server composited them: every stall number is a main-thread interval. Contrast on the real vibrant materials: the ratios are from the token values.

## What the glow costs

The first glow was a line and an 8 point halo. It was measured in the app only, where it cost nothing, and reported as free. Seen on a pale canvas it was a second selection ring, and measured in the render server it was not free either.

The glow is now a light: a line, a halo and a wide bloom under the frame, with a brighter stretch travelling round it.

| | The app | The render server |
| --- | --- | --- |
| Nothing lit | 0.0% | 44%, with other apps drawing |
| One frame lit | 0.0% | 52 to 54% |
| Five frames lit | 0.0% | 59 to 61% |
| Five frames lit, standing still | 0.0% | 44% |

So a lit frame costs the render server about 8% of a core and each further frame about 2%, for as long as a turn runs. Asking for thirty frames a second, rasterizing the bloom's mask and stepping the light 24 times a second were each tried. The first two changed nothing and the third saved 1% a frame, so none was kept.

A Metal gradient package was measured for the first version in a test window and not used:

| | Footprint | CPU while running | Binary |
| --- | --- | --- | --- |
| A bare AppKit window | 15 MB | 0.2% | 54 KB |
| ColorfulX 5.8, 30 frames a second, quarter scale | 85 MB | 2.1% | 548 KB |
