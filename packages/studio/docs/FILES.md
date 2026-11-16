# Files

How a Lune design is laid out on disk, how the editor reads a file and what it imports, and how a file travels to someone else.

## A project

A design is small pieces, connected. A project keeps them in three folders and a token file:

```text
design/
  tokens.lune               colours, numbers and type, nothing else
  controls/                 the UI basics
    Button.lune
    Chip.lune
  blocks/                   groups of controls
    PhaseCard.lune
  screens/                  complete views
    Tonight.lune
  images/
    moon.png
```

| Rule | Why |
| --- | --- |
| One component per file, and the file is named after it: `controls/Button.lune` declares `Button` | Finding a component is finding a file. A diff of a component is a diff of one file |
| A control or block file also holds frames that show its component: its states, its sizes, day and night | Opening the file shows the piece, the way a screen file shows the screen |
| A screen file holds frames and no components, unless one screen is shown twice, by day and by night | A screen is where pieces are used, not declared |
| Controls use tokens. Blocks use controls and tokens. Screens use blocks, controls and tokens. Never upwards | The graph has one direction, so a change to a control reaches every block and screen, and nothing loops |
| Tokens live in one file | A colour is decided once |

The editor lists files under Controls, Blocks and Screens by the nearest folder of that name, or the file's own name, and everything else under Other. None of this is enforced: a file that breaks a rule still opens and draws.

## Imports

```xml
<use src="../controls/Button.lune" />
<use src="/tokens.lune" />
```

`use` brings in a file's tokens and components, and those of every file it uses in turn. A path is relative to the file that writes it. A path that starts with `/` is relative to the project root. The root is the nearest folder above the file that holds `.git`. A file outside any project has no root of its own: its relative imports are followed wherever they lead on disk, and a `/` import needs a project.

When two files in reach declare the same name, the nearer one wins: the file's own declarations over what it imports, and a direct import over one further along.

## Reading a file

The editor reads a file in four steps. None of them stops at the first problem: a file always opens and draws as much of itself as it can.

1. **Parse.** A file that doesn't parse keeps its last good frames on the canvas, marked with the line of the error.
2. **Follow imports.** Every `use`, and every `use` in those files, is read once. Each import is found, missing (no file at that path) or broken (the file doesn't parse).
3. **Resolve names.** Every component and token the frames name is looked up in what the file declares and imports.
4. **Draw.** What resolved draws as written. What didn't:

| Missing | Drawn as | Said |
| --- | --- | --- |
| An imported file | Nothing of its own; its components count as missing | On the file's label on the canvas, and as a warning with the line of the `use` |
| A component | A dashed placeholder the size the instance asks for, named, so the layout keeps its shape | A warning with the line of the instance; the inspector names the component as missing |
| A token | The attribute is left out, as if it weren't written | A warning |

## A file from a friend

A file someone sends usually arrives without the files it imports. Two things make that work.

**Packing.** `lune pack screens/Tonight.lune` writes one self-contained file: every token and component the screen uses, copied in, each after a comment naming the file it came from, then the screen's own frames, with its `use` lines dropped. A packed file draws the same anywhere. The comments are enough for it to be unpacked into a project's folders again.

**Opening an unpacked file.** A file whose imports aren't there opens anyway. Its frames draw, every piece that's missing is a named placeholder, and its label on the canvas says how many files it is missing. The fix is to put the missing files next to it, or to ask Nyte to make them from what the placeholders say.

## Not built yet

- Opening a single file from outside a project in the app. The app opens projects through Nyte, so a file in Downloads opens in `lune` today and in the app once it can open a folder that isn't a Nyte project.
- Unpacking a packed file into the three folders.
- A list of a file's imports and their state in the inspector, and Locate… for a missing one.
