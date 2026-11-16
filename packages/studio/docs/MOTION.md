# Motion

What moves, when, on which curve, and what stays still. Durations and curves are Nyte's motion tokens. Measurements are in [benchmark](BENCHMARK.md).

## Policy

Reduce Motion outranks everything. A key gets no animation: a shortcut is pressed again and again, and anything that plays out is in the way. A gesture tracks the fingers one to one. A click, or the agent, gets the motion that shows where things went.

| Action | From a click, a gesture or the agent | From a key | Reduce Motion |
| --- | --- | --- | --- |
| Go to a file, a frame or the selection | Flight on the spring | Cut | Cut |
| Zoom to fit | Flight on the spring | Cut | Cut |
| Zoom step, zoom to a percentage | Cut | Cut | Cut |
| Scroll, pinch, drag the canvas | One to one | | One to one |
| Zen | Sides cut. Traffic lights and the dock fade out 150 ms, in 200 ms | The same | Fades stay |
| Summon or dismiss the zen composer | | Instant | Instant |
| Zen hint | Fade in 200 ms, out 150 ms after 2.5 s | The same | Fades stay |
| A line arrives in the dock: what the agent is doing, its answer, a notice | The dock is its new size at once. The line fades in over 200 ms | | Fade stays |
| The dock shows or goes in zen, with something to say or nothing left | Fade in 200 ms, out 150 ms | | Fades stay |
| Moonlight on a frame | Up over 400 ms. Down over 600 ms, 1.5 s after the work stops. A brighter stretch of the bloom goes round once in 6 s | | Rise and fall stay. The bloom is even all round and never travels |
| A frame arrives | Fade in 200 ms | | Fade stays |
| A change lands from outside | The frame it changed is lit for 1.5 s, by the same rise and fall | | The same |
| Sidebar and inspector toggles | The split view's slide | Cut | Cut |
| Agent panel | The popover's own animation | | No animation |

The dock's size is never animated. It grows and shrinks from a fixed bottom edge, by a row at a time, and a moving edge over the design would be chased by the eye for no gain.

## Curves

| Token | Curve | For |
| --- | --- | --- |
| `outQuint` | `cubic-bezier(0.16, 1, 0.3, 1)` | Anything that enters or leaves |
| Ease out, then ease in and out | Core Animation's own | The moonlight coming up, and going down |
| Linear | | The moonlight's turn, which is constant motion |
| `NyteSpring.travel` | Mass 1, stiffness 520, damping 46, damping ratio 1.009 | The camera |

An exit is never longer than its entrance. Nothing enters from nothing: a fade starts from the opacity on screen, and no element scales up from zero.

## The camera

The camera is three numbers: the log of the zoom and the design point at the middle of the view. Each rides its own spring. A flight lands when it is within a quarter of a point and a twentieth of a percent of its target and all but still.

A flight that is redirected keeps the speed it has. The new flight starts from the position and velocity the old one had at the time of the frame on screen, so there is no jump and no restart from rest.

While the camera flies, the bitmaps the landing needs are drawn, so the designs are sharp when it arrives.

A frame of a pan, a zoom or a flight sets one transform on the designs and one on the glows, and moves each label. It does not walk the frames. They are laid out again on whole pixels when the camera rests.

## The moonlight

A frame the agent is working on is lit, and so is a frame anything else just changed. The light is three things in the same colours: a line a point and a half wide just outside the frame's edge, a tight halo, and a bloom that reaches about sixty points onto the canvas. The colours run from the mark's night blue at the bottom left to the warmth of its light at the top right, by way of violet and rose, so the mix never passes through grey. They are deeper on a pale canvas.

The layer sits under the frames. A frame covers the inside of its own glow, so the light never tints a design, and a neighbour's frame covers the bloom that would fall on it. A lit frame casts no shadow of its own.

A brighter stretch of the bloom goes round the edge once in six seconds. The render server turns it: the app does no work per frame, runs no display link for it, and holds no bitmap.

The light comes up over 400 ms when a turn first touches a frame: the one the agent was asked about, at once, and the frames of each file as a step of the turn edits it. It stays for 1.5 s after the turn ends, so a change that lands as the turn finishes is seen lit, then goes down over 600 ms. These are slower than a control's 150 and 200 ms on purpose. A bloom this wide that arrived in 200 ms would read as a flash.

There is no ring round each element that changed. A token edit used to draw twenty of them, round every icon it touched.

It is not free. With a frame lit the render server uses about 8% of a core more, and 2% more for each further frame, and none once the light stands still or is gone. A Metal gradient package was measured for the first version of this and not used: it added 70 MB and 2% of a core inside the app.

## Who owns what

| State | Owner |
| --- | --- |
| Zoom, pan, the flight in progress | The canvas view |
| The camera the layers were last laid out for | The canvas view. A transform makes up the difference until the next layout |
| Which frames wear the moonlight | The canvas, from the files the workbench says the turn is on and the changes it is told of |
| What the dock says | The workbench: a notice while it lasts, else the turn in progress, else the last word of the turn that just ended |
| Zen, and what the sides were before it | The model and the window controller. Not saved |
| A fade in progress | The layer's own animation. A new fade replaces it from the opacity on screen |

## Interruption

- A new flight replaces the target from the presented position and velocity.
- A fade that is reversed turns round where it is.
- Leaving zen while the composer is fading out brings it back from the opacity it reached.
- A timer that would hide a hint or a notice is cancelled when a newer one starts.
- Nothing that cleans up, saves or changes focus waits for an animation to finish.

## Proof

| ID | Exercise | Pass | Measured |
| --- | --- | --- | --- |
| M01 | Seven flights on the sample project | At least 99% of main-thread intervals within 1.5 refreshes, none over 3 | 100%, longest 16.8 ms |
| M02 | The same with 200 more frames | The same | 100%, longest 19.2 ms |
| M03 | Redirect a flight 70 ms in, same direction | No restart from rest | Speed goes 5.7 to 6.7 to 8.3 per second across the redirect |
| M04 | Redirect a flight the other way | Speed passes through zero without a jump | 6.0, −4.5, −16.0 per second on consecutive frames |
| M05 | Spring against its numbers | No overshoot | 0% overshoot, 99% of the way in about 300 ms |
| M06 | Zen on, then off 140 ms later | No jump in the composer's opacity, right final state | 1, 0.42, 0.09, 0.02, 0, then 0.02, 0.47, 0.84, 0.95, 1 |
| M07 | Idle for 30 s with the window showing | No display link, CPU at or under 0.5% | 0.045%, 13 wakeups |
| M08 | One frame lit, then five, for 12 s each | Report | The app: 0.0%. The render server: 44% at rest with other apps drawing, 52% with one frame lit, 60% with five, 44% again with the five standing still |
| M09 | Reduce Motion, by reading the code | What moves is cut, what fades stays | Fades go through `NyteMotion.fade`, which has no cut. The camera cuts, the sides cut, the light never travels |
| M10 | Every chrome fade, sampled each refresh and fitted | The declared curve at the declared duration | Eight fades, RMS 0.001 to 0.004 against `outQuint`: dock out 150 and in 200, traffic lights the same, controls in 100 and out 150, hint in 200 and out 150 |
| M11 | Toggle each side with a key press current, then without | One change of the canvas's width; a slide | One change per toggle, 4 of 4. Without the key, 14 widths over 230 ms |

M10 found one fade that was not a fade. A view shown for the first time carried the opacity it had before it was hidden, so its fade ran from 1 to 1: the zen hint and the canvas controls popped the first time they appeared. A fade from hidden now starts from nothing.

Not measured: the curves as the window server composites them, the popover's own animation, and Reduce Motion with the setting turned on.
