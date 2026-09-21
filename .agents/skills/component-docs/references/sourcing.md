# Sourcing every claim

A claim you cannot trace to a file does not go on the page. Soften nothing, cut it.

| Claim                     | Read it from                                            |
| ------------------------- | ------------------------------------------------------- |
| An import path            | `exports` in `packages/ui/package.json`                 |
| A name from the root      | `packages/ui/src/index.ts`                              |
| A name from a subpath     | `packages/ui/src/<name>.ts`                             |
| Our props and defaults    | `packages/ui/src/components/ui/<name>.tsx`              |
| A union's members         | The exported type, every member of it                   |
| A Base UI part            | A file in `content/base-ui-reference/<component>/`      |
| A Base UI prop or default | The same directory, never memory                        |
| What a real usage is like | Call sites in `packages/desktop/src`, as a check only   |

## Rules these came from

Each one is a defect that shipped.

- **Never write an export that does not exist.** A page showed
  `import { Button as ButtonPrimitive }`. There is no `ButtonPrimitive`. The alias was invented to
  make a sentence read well, and readers would have imported a name that is not there.
- **Rename only to resolve a collision in the same file.** Dialog earns one, because the root
  exports `Dialog` with no Trigger or Close and the subpath exports `Dialog` as the namespace. Say
  in the page that the alias is the reader's local name. Nothing else earns one.
- **Enumerate a union from the type, not from a neighbouring page.** Button shipped five variants
  while the page documented four, because the demo rendered four and the page copied the demo.
- **Teach the common path first.** Alert dialog led with `createHandle()`, an API the repo calls
  once, because Base UI gives handles a section on every overlay page. The common paths are
  nesting the trigger and controlling with `open` and `onOpenChange`. Order examples by what a
  reader needs in their first ten uses.
- **Check paired prop names against each other.** `pressed` with `onPressedChange` is a toggle,
  `checked` with `onCheckedChange` is a switch. Mixing them reads fine and compiles nowhere.

## Snippets are code

Examples get pasted. They follow the repo style in the root `AGENTS.md`: no `any`, no casts
including `as T`, erasable syntax, top-level imports, no star imports, no renamed imports except
the collision above, prefer `const`. A snippet that would fail review in the repo is a defect in
the page.

## Before reporting done

- Every name in every import exists in the package.
- Every `<include>` path resolves.
- Every union is complete.
- `pnpm --dir packages/docs types:check` passes.
- `pnpm format` is clean.
