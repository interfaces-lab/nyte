---
name: naming
description: >
  Use before naming or renaming a type, record, schema, concept, UI word, command, or a
  package-level module or folder: a new session, turn, pane or lane concept, a label users see,
  a `*Record` or wire type, or a new folder in the app or core. Trigger on "what should this be called",
  "rename", "new concept", "is X the same as Y", or a word the code spells two ways.
---

# Naming

One name per concept. Before you add or change a name:

1. Read [glossary.md](glossary.md). Use its **Term** in code and its **UI word** in copy users
   see. Never use a word from its **Don't use** column for that concept.
2. If the concept is already there under another name, use that name; don't add a synonym.
3. A new concept gets a row in the glossary in the same change, with its meaning and, when it
   differs, the UI word. Keep a row to one line.
4. Wire and stored names (`packages/schema`, core's `*Record` schemas) keep their spelling. A
   rename there is a migration, not a naming fix; leave it unless asked.

In the app and in core, each folder owns one concept. Put a new module in the folder that owns
it. A new folder is named for its concept and added to that package's `layers` in
`scripts/check-layers.mjs`. `pnpm layers` fails on a folder with no layer and on an import that
reaches a higher one.
