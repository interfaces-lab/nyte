# Design choices

Why the chrome is the way it is. [Spec](SPEC.md) says what it does, [motion](MOTION.md) how it moves.

| Choice | Reason | Avoid |
| --- | --- | --- |
| AppKit only | One process at 42 to 49 MB, native text input, native source list and split view | A web view, or SwiftUI chrome hosting AppKit |
| A second client of the Nyte host | The agent, the models and the chats already exist. Studio adds a canvas, not a second product | A bundled host, a second sign-in |
| Designs are text files | The agent edits what the person edits, with the tools it already has, and git sees a diff | A binary document only one app can open |
| One canvas for every file | A file is a place, so choosing one moves the camera and nothing is ever unloaded | Tabs, or one document per window |
| One toolbar row | Every window-wide control sits in the toolbar, on the line of the window's own buttons, each over the column it acts on: the sidebar's toggle over the sidebar; the project, day or night, zoom and zen over the canvas; Design or Chat and the inspector's toggle over the inspector. The columns start right under it, so the sidebar and the panel begin on one line. Zen puts the toolbar away with the sides | Controls floating on the canvas at a second height, or a panel switch told apart by the weight of a word |
| You ask and are answered where the conversation is | The composer sits at the foot of the Chat tab, under the chat it adds to, with the selection as a chip inside it. Over the canvas it floats only while the chat is off screen: in zen mode, or with the panel put away. A turn that ends while the chat is out of view puts a badge on the Design or Chat switch | A composer over the designs while the chat is open beside it, or a reply in a toast that is cut at one line and gone in five seconds |
| One composer | It is the same control in zen mode and out of it, on the same plain surface. Zen only decides whether it is showing | A second skin for the same control |
| Stop is beside what it stops | The line that says what the turn is doing ends in the stop button. The send button only sends | A send button that turns into something else while you are reaching for it |
| Glass for moments, plain surfaces for tools | Glass shimmers over a design that changes under it, and on a pale canvas with nothing behind it to bend it is hard to see at all. The zen hint and the project picker are moments. Everything used all day, the composer included, sits on a blurred, tinted surface that keeps its own colour | Glass on anything clicked ten times a minute |
| Connection in words, where it matters | A dot answers no question. The agent panel names the host, each provider and the Lune skill, and a composer that can't send says why | One ambiguous status light |
| Working, waiting and stopped are three marks | Each answers a different question about a chat | One busy spinner for all three |
| The canvas is the feedback | A frame the agent is working on is lit: a line on its edge and a bloom that spills onto the canvas, in the mark's night blue and the warmth of its light. The change lands inside the lit frame and the light goes. A frame changed from outside is lit the same way for a moment | A reply bubble, a ring round every element that changed, sparkles, a rainbow, a glow that only decorates |
| The light is under the design | The glow lies beneath the frames, so it shows only outside a frame's edge and never tints what is being designed | A highlight drawn over the work |
| Layout only takes tokens | A gap is a `NyteSpace` step and a control a `NyteControl` height because the functions accept nothing else, and `check:layout` rejects a bare number | Sizes nobody decided on |
| The system's control heights | Small, regular and large controls are 20, 24 and 28 points, which are Nyte's own `xs`, `sm` and `md`. A drawn control and a native one line up | A control at 23 points beside one at 22 |
| One inset per panel | Everything with an edge starts on it. A button with no edge until hovered starts one padding earlier, so its title lands on it | A column of left edges two points apart |
| Captions in one column, controls in the other | Every caption shares an edge and so does every field. Position and size pair their fields inside the control column | Fields that start wherever their caption ends |
| Nested corners add up | A capsule's padding plus its button's radius is the capsule's radius. The same for the composer and its send button, and the picker and its rows | The same radius on a parent and its padded child |
| Preserve the canvas when the host goes | The designs stay as they last were and the composer keeps the draft | A blank window with a spinner |

## Scales

All from `@nyte-ai/ui`. Colours are generated from its platform colour table; `check:tokens` fails when they drift.

| Scale | Steps |
| --- | --- |
| Space | 1, 2, 4, 6, 8, 10, 12, 16, 20, 24, 32 |
| Control height | 16, 20, 24, 28, 32, 36 |
| Radius | 4, 8, 12, 16, and half the height for a capsule |
| Symbol box | 10, 12, 14, 16, 20 |
| Type | 11, 12, 13, 15, 19, 24 |
| Duration | 50, 100, 150, 200 ms |

Sizes that are not a step of a scale are named in `NyteMetric`, each with what it is for. Only that file can make one.

## Surfaces

| Surface | Material |
| --- | --- |
| Sidebar, inspector | The system's, from the split view |
| The dock, the editing capsule | `FloatingSurface`: a within-window blur, Nyte's popup tint, a hairline and a soft shadow |
| Zen hint, project picker | `GlassSurface`: the system's glass |
| Agent panel | The system's popover |
| Inspector fields | Nyte's quiet input: a muted fill and a hairline that turns to the accent while it has the focus |

## Polish gate

- Every control height, gap and pointer target passes on alignment rectangles, in the selection, chat, zen and picker states.
- Text is at least 4.5 to 1 against what it sits on, in light and dark.
- Nothing is cut off without a way to all of it. A long path has a tooltip, long markup wraps and says how many lines are left.
- A state shown by colour is also said in words.
- Reduce Motion removes what moves and keeps what fades.

## After Elyx

The lit frame follows what the Elyx team showed of their agent experience in October 2026: the frame glows, the change lands inside it, the glow fades, and there is no chat box in the picture. The colours and the timing here are Nyte's. Their beta, seen in November 2026, keeps the agent in a tab beside the inspector with the composer at its foot and the selection as a chip in it, and shows nothing over the canvas but its controls. This app does the same, and floats its dock only when that panel is off screen.

## The inspector

A designer reads a panel by the shape of its controls before reading a word, so each kind of value has one shape.

| The value | Its control |
| --- | --- |
| One of a few fixed answers: direction, align, justify, text alignment, image fit | A `SegmentedPicker`: a muted track, the chosen segment filled and tinted, a symbol that draws the answer |
| One of many: a type style, a weight, how a size is worked out | A filled `MenuButton` |
| A number | A `NyteField` with a symbol or a letter before it. The arrows step it, by ten with Shift, and a drag on the symbol changes it while the canvas follows |
| A colour | The system colour well, the value as written, and a menu of the colour tokens the file can see, each with its swatch |
| On or off | A switch |
| Words | A plain field |

A field shows what the file writes. When the file writes nothing it shows, in grey, what applies. A token shows as its name. Every row ends on the panel's trailing inset, and controls that share a row share it equally.

## Selecting

A click selects the deepest thing the sheet's own file writes, and an instance of a component is one thing. A double click goes into the instance, to the part under the pointer, and from then on a click selects parts. Command-click takes the deepest thing under the pointer from anywhere. Esc steps out one level. What is inside a component is outlined in purple, and a capsule at the top of the canvas names the component and says how many instances an edit will change.

## The project

A project is small pieces, connected: controls, the UI basics; blocks, groups of controls; screens, complete views. Each component gets its own file, controls are imported into blocks and blocks into screens. The sidebar lists files under Controls, Blocks and Screens by the folder each is in, as flat lists, so a name is never cut to fit an indent. The window is one colour, the canvas's, with the toolbar's controls and the panels' glass on it.
