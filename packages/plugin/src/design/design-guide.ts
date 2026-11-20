import type { Plugin, PluginApi } from "@nyte-ai/plugin/core";
import { DESIGN_ATTRIBUTE } from "./board-protocol.ts";

const FRAME = DESIGN_ATTRIBUTE.frame;

const X = DESIGN_ATTRIBUTE.x;

const Y = DESIGN_ATTRIBUTE.y;

const PAGE = DESIGN_ATTRIBUTE.page;

const THEME = DESIGN_ATTRIBUTE.theme;

export const DESIGN_GUIDE = `# Writing designs for Nyte Studio

A design is plain React JSX and CSS in the workspace's \`design/\` folder. Nyte Studio draws every
file on one board, where people select, retype and move what you wrote. Write them so the board can
map what it draws back to your source.

## Files

- Put designs at \`design/**/*.jsx\`, and their styles in \`.css\` files they import:
  \`import "./tonight.css";\`.
- Put tokens in \`design/tokens.css\` as CSS custom properties. Day values go on \`:root\`; night values
  go under \`[${THEME}="night"]\`.
- Write components as plain function components, export them by name, and import them by relative
  path with the extension: \`import { Button } from "../controls.jsx";\`.
- Import only \`react\` and your own \`.jsx\` and \`.css\` files under \`design/\`. Nothing else
  resolves, and \`nyte/canvas\` is for chat drawings, never designs.
- A design runs sandboxed: no network, images only as \`data:\` or \`blob:\` URLs. Draw icons as inline
  SVG.

## Frames

- A frame is an element with a \`${FRAME}\` name written as a plain string, inside no other frame:
  \`<div ${FRAME}="Tonight" ${X}="0" ${Y}="0" className="tonight">\`. A \`${FRAME}\` inside a frame
  makes no second frame. A file's default export renders its frames.
- Place a frame with whole numbers, as a string or a number in braces: \`${X}="480"\` or
  \`${X}={480}\`. A frame placed any other way, or missing one of the two, can't be moved on the
  board.
- Give a frame its width (and height, for a screen) in CSS or a literal \`style\`.
- The board's Day/Night control sets \`${THEME}\` on each frame. A frame that writes its own
  \`${THEME}="night"\` keeps it.
- A file without a default export shows in the list and draws nothing.

## Live pages

- A frame with \`${PAGE}\` holds a live web page instead of your JSX:
  \`<div ${FRAME}="Checkout" ${X}="0" ${Y}="0" ${PAGE}="http://localhost:3000/checkout" style={{ width: 1280, height: 800 }} />\`.
- Its width and height are the page's viewport, so size it like the window you want to see the page
  in: 1280 by 800 for a laptop, 390 by 844 for a phone.
- Write the address as a plain string literal on the frame's own tag, with no spaces or escapes:
  \`${PAGE}="http://…"\` or \`${PAGE}="https://…"\`. Only that form loads a page; an expression, a
  template, another scheme, or a value the design changes while it runs never does.
- Leave the frame empty. The board shows the address until someone selects the frame. In the
  desktop app, in a workspace the person trusts, selecting it loads and shows the live page,
  double-clicking it lets people use the page, and after that the board keeps a picture of the page
  in the frame. A page on the board downloads nothing, opens no popups and can't sign in through a
  login prompt.

## What people can edit on the board

- Literal words between a DOM element's tags (\`<span className="title">Tonight</span>\`) can be
  retyped in place, and the board writes the smallest change back to the file when typing ends.
  It writes \`&\`, \`<\`, \`>\`, \`{\` and \`}\` as \`&amp;\`, \`&lt;\`, \`&gt;\`, \`&#123;\` and \`&#125;\`,
  and keeps the space around the words. Character references in your words keep them editable.
- A frame's \`${X}\` and \`${Y}\` change to whole numbers when someone drags it by its label, once,
  when the drag ends.
- Words that come from an expression stay read-only: a prop (\`{label}\`), a template, a \`.map\`, a
  condition, children passed to a component, or text mixed with other elements. Keep copy people
  will want to tweak as literal text inside the DOM element that draws it.
- An edit on the board is made against the file as the board drew it. If you changed the file
  since, the board refuses the edit instead of writing over your change.

## What people send you

- When someone adds an element from the board to the chat, it arrives as an excerpt with
  \`source="design"\`, the file's \`path\` and, when the element is in one, its \`frame\`. The excerpt
  holds the element's source as it was then; find it in the file by that text, which may have
  changed since.

## Example

\`\`\`jsx
// design/screens/tonight.jsx
import "../tokens.css";
import "./tonight.css";
import { Button } from "../controls.jsx";

export default function Tonight() {
  return (
    <div ${FRAME}="Tonight" ${X}="0" ${Y}="0" className="tonight">
      <span className="display">Tonight</span>
      <Button label="Wake me at moonset" />
    </div>
  );
}
\`\`\`
`;

export default {
  id: "design-guide",
  contribute: {
    prompt: [
      {
        id: "design",
        order: 60,
        text: async (context) => ((await hasDesigns(context.api)) ? DESIGN_GUIDE : null),
      },
    ],
  },
} satisfies Plugin;

async function hasDesigns(api: PluginApi): Promise<boolean> {
  const found = await api.env.files.stat(`${api.env.cwd}/design`).catch(() => null);

  return found?.kind === "directory";
}
