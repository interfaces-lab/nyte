# Sourcing every claim

Trace every claim to a file. A higher source wins:

1. `packages/ui/src` and `exports` in `packages/ui/package.json`: import paths from `exports`;
   names, props and defaults from the file the subpath's `nyte-source` entry names; a union's every
   member from its exported type.
2. The installed `@base-ui/react` types.
3. `content/base-ui-reference/`, generated from the pinned Base UI release. Fix its wording in the
   generator.
4. Existing pages. Every recorded defect came from trusting one over the source.

Call sites in `packages/app/src` only check real usage. Snippets follow the root `AGENTS.md` code
style.

## Named failures

Each shipped; check for them in review.

- **Invented export.** A page imported `createPreviewCardHandle` before ui exported it.
- **Neighbour copy.** A dozen pages copied one guess that `className` and `style` "take plain
  values, not functions of state". `StyledProps` keeps Base UI's types, so state functions work.
- **Demo as union.** Button's page listed only its demo's variants. A demo may show a subset; the
  props table lists every member.
- **Upstream emphasis.** Alert dialog led with `createHandle()`, copying Base UI's overlay pages.
  Lead with nesting the trigger, then `open` with `onOpenChange`.
- **Crossed pairs.** `pressed` goes with `onPressedChange`, `checked` with `onCheckedChange`.
- **Qualifier creep.** Patching with "unless", "except" and "with the default" grew the prose 40%.
  Replace a wrong sentence. If the true one needs a qualifier for a case outside a reader's first
  ten uses, cut the sentence.

## Before reporting done

`pnpm --dir packages/docs typecheck` skips MDX and passes with a broken snippet. Check by hand that
every imported name is exported by its subpath, every props-table union is complete and every
`<include>` resolves from its page. Then run that typecheck and `pnpm format`.
