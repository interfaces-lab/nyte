# Sourcing every claim

A claim you can't trace to a file doesn't go on the page.

| Claim                      | Read it from                                                   |
| -------------------------- | -------------------------------------------------------------- |
| An import path             | `exports` in `packages/ui/package.json`                        |
| A name, prop or default    | The file that subpath's `nyte-source` entry names              |
| A union's members          | The exported type, every member of it                          |
| A Base UI part or prop     | The installed `@base-ui/react` types, then the generated table |
| What real usage looks like | Call sites in `packages/app/src`, as a check only              |

## Named failures

Each one shipped. Look for them by name in review.

- **Invented export.** `createPreviewCardHandle` was documented and never exported.
- **Neighbour copy.** About a dozen pages say `className` and `style` "take plain values, not
  functions of state". `StyledProps` keeps Base UI's types, so state functions work. One page
  guessed and the rest copied it.
- **Demo as union.** Button's page listed the four variants its demo rendered, against five in the
  type. A demo may show a subset. The props table lists every member.
- **Upstream emphasis.** Alert dialog led with `createHandle()` because Base UI gives handles a
  section on every overlay page. Lead with nesting the trigger, then `open` with `onOpenChange`.
- **Crossed pairs.** `pressed` goes with `onPressedChange`, `checked` with `onCheckedChange`.
- **Qualifier creep.** An audit that fixed overbroad sentences by adding "unless", "except" and
  "with the default" grew the prose 40%. A correction replaces the wrong sentence. If the true
  version needs a qualifier for a case outside a reader's first ten uses, cut the sentence.

Snippets follow the root `AGENTS.md` code style.

## Before reporting done

`pnpm --dir packages/docs typecheck` doesn't read MDX and passes with a broken snippet. Check by
hand that every imported name is exported by its subpath, every props-table union is complete, and
every `<include>` resolves from its page. Then run that typecheck and `pnpm format`.
