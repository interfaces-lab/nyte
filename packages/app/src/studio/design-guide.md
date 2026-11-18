# Writing designs for Nyte Studio

A design is plain React JSX and CSS in the workspace's `design/` folder. Nyte Studio draws every
file on one board, where people select, retype and move what you wrote. Write them so the board can
map what it draws back to your source.

## Files

- Put designs at `design/**/*.jsx`, and their styles in `.css` files they import:
  `import "./tonight.css";`.
- Put tokens in `design/tokens.css` as CSS custom properties. Day values go on `:root`; night values
  go under `[data-theme="night"]`.
- Write components as plain function components, export them by name, and import them by relative
  path: `import { Button } from "../controls.jsx";`.
- Import only `react`, your own `.jsx` files and your own `.css` files. Nothing else resolves, and
  `nyte/canvas` is for chat drawings, never designs.
- A design runs sandboxed: no network, images only as `data:` or `blob:` URLs. Draw icons as inline
  SVG.

## Frames

- A file's default export renders its frames: top-level elements with a literal name and place.
  `<div data-frame="Tonight" data-x="0" data-y="0" className="tonight">`.
- Give a frame its width (and height, for a screen) in CSS or a literal `style`.
- The board's Day/Night control sets `data-theme` on each frame. A frame that writes its own
  `data-theme="night"` keeps it.
- A file without a default export shows in the list and draws nothing.

## What people can edit on the board

- Literal words between a DOM element's tags (`<span className="title">Tonight</span>`) can be
  retyped in place, and the board writes the smallest change back to the file.
- A frame's literal `data-x` and `data-y` change when someone drags it by its label.
- Words that come from an expression stay read-only: a prop (`{label}`), a template, a `.map`, a
  condition, children passed to a component, or text mixed with other elements. Keep copy people
  will want to tweak as literal text inside the DOM element that draws it.

## Example

```jsx
// design/screens/tonight.jsx
import "../tokens.css";
import "./tonight.css";
import { Button } from "../controls.jsx";

export default function Tonight() {
  return (
    <div data-frame="Tonight" data-x="0" data-y="0" className="tonight">
      <span className="display">Tonight</span>
      <Button label="Wake me at moonset" />
    </div>
  );
}
```
