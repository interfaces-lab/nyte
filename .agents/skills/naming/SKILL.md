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

One name per concept. Before you add or change a name:

1. Read [glossary.md](glossary.md). Use its Term in code and its UI word in copy users see. Never
   use a word from its Don't use column for that concept.
2. If the concept is already there under another name, use that name. Don't add a synonym.
3. Give a new concept a one-line row in the glossary in the same change, with its meaning and the
   UI word when it differs.
4. Leave wire and stored names (`packages/schema`, core's `*Record` schemas) spelled as they are
   unless asked. Renaming one is a migration, not a naming fix.

In the app and core, each top-level source folder owns one concept. Put a new module in the folder
that owns it, and name a new folder for its concept. `pnpm layers` then says where to register it.

## Not covered

- Which layer a new folder joins.
