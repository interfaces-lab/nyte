---
name: naming
description: >
  Use before naming or renaming a type, record, schema, concept, UI word, command, or a
  package-level module or folder: a new session, turn, pane or lane concept, a label users see,
  a `*Record` or wire type, or a new folder in the app or core. Trigger on "what should this be called",
  "rename", "new concept", "is X the same as Y", or a word the code spells two ways. Not for
  writing the rest of a label's sentence or a message's tone.
---

# Naming

One name per concept. Before adding or changing a name, read [glossary.md](glossary.md):

- Use its Term in code and its UI word in user-facing copy, never a word from Don't use.
- A concept already listed under another name keeps that name. Add no synonym.
- A new concept gets a one-line row in the same change, with its meaning and its UI word if different.
- Wire and stored names (`packages/schema`, core's `*Record` schemas) stay as spelled unless asked. Renaming one is a migration.

In the app and core, each top-level source folder owns one concept. Put a new module in the folder that owns its concept, name a new folder for its concept, and register it where `pnpm layers` says.

## Not covered

- Which layer a new folder joins.
