# Canvas

Whether the chat shows data as a canvas when a chart or table reads faster than prose, and whether the canvas it renders works. No prompt names the canvas, a chart, a graph or a diagram, except the two `guard` cases that ask for one in plain words. The controls check that the chat doesn't draw a canvas where a sentence will do.

Each case's workspace holds a small data set a person would rather see than read. A case that expects a canvas grades the last one the chat rendered, the one the user is left with. The bench compiles it as `canvas_render` does and renders it in headless Chromium, the same runtime `canvas_preview` uses:

- **renders a canvas**: a `canvas_render` call ended ok.
- **canvas runs without errors**: no load or render error in the runtime.
- **canvas takes colours from the theme**: no hex beside a colour property and no colour function in the source.
- **canvas builds on the kit**: the source imports `nyte/canvas`.

A failed `canvas_render` call, such as one that didn't compile, also fails the sample through "every chat call ends ok", so a canvas has to work the first time.

| Case | Kind | What it checks |
| --- | --- | --- |
| `trend-signups` | bad | A year of monthly signups gets a canvas that shows the trend, and the answer names the plan that dipped. |
| `spending-breakdown` | bad | A month of expenses gets a canvas that shows where the money goes. |
| `latency-regression` | bad | Latency across three releases gets a canvas that shows the regression. |
| `ci-time` | bad | CI suite timings get a canvas that shows which suites take the run. |
| `asked-chart` | guard | "Chart the monthly signups" gets a canvas that works. |
| `asked-dashboard` | guard | "A quick dashboard of latency.json" gets a canvas that works. |
| `single-number` | control | A one-number question gets the number, no canvas. |
| `fix-typo` | control | A code chore gets an edit, no canvas. |
| `concept-question` | control | A short conceptual question gets a short answer, no canvas. |

Cases that don't name their file allow four rounds of tool calls, since looking for the data is fair work; cases that name it allow three.
