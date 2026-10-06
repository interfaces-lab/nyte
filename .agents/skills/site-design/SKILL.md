---
name: site-design
description: >
  Nyte's design direction for the public site in packages/docs: the landing page, marketing
  sections, long-form pages such as the ethos and manifesto, and the docs site chrome and page
  layout. Use whenever work changes what a visitor sees or reads outside the component reference:
  heroes, sections, visitor-facing copy, motion, site navigation, doc page layout, or a new essay.
  Trigger on landing, hero, homepage, marketing, ethos, manifesto, vision, docs layout, docs
  polish, "make it feel like the hero", or a request to review the site against our style.
  Not for Cloud component pages under content/cloud (use component-docs), the desktop app, the
  TUI, or lab prototypes.
---

# Site design

The site has one job: show a developer what Nyte is and let them try it. It does that with the
product itself, a few true sentences, and motion that rewards attention.

## Operating contract

- **Every claim is true today.** A headline, a fact pill, and a preview fixture are all claims.
  Trace each to a source in [references/copy.md](references/copy.md) before it ships.
- **Show the product, then describe it.** The preview renders the real hosts. Copy points at
  what the preview proves.
- **Make sentences interactive instead of making lists.** When copy starts to enumerate, keep two
  or three words and let them carry the detail on hover.
- **One control per state.** If the dock switches the preview, nothing else does.
- **Motion explains or rewards; it never loops for attention.** Every animation has a
  reduced-motion path and a keyboard path that shows what hover shows.
- **Reuse before adding.** `KeyLink`, `FactWord`, `HostStage`, `NavSentinel`, `DocArticle`.
- **No uppercase.** Not in CSS, not in copy, not in a pill. Mono and a muted colour carry a label.
- **Delete what lost.** A hero that is no longer shipped is removed, not parked.
- **Verify the rendered page.** Code review cannot establish visual quality. Say so when the user
  has not looked yet.

## Request modes

| Mode      | Typical request                         | Behaviour                                                                 |
| --------- | --------------------------------------- | ------------------------------------------------------------------------- |
| Shape     | "How should the ethos page work?"       | Compare options against the references, name open decisions, do not edit |
| Implement | "Build", "merge", "replace", "add"      | Smallest coherent change that follows the references                      |
| Review    | "Audit", "what's off?", a screenshot    | Findings ordered by visitor impact, each with file and fix; do not edit   |
| Copy      | "Better copy", "rewrite the subhead"    | Words, link targets, and accessible names only                            |

## Authority

1. The user's explicit goal.
2. Shipped behaviour: `README.md`, `packages/core/src/kernel/README.md`, package READMEs, and
   source. `packages/docs/content/kernel/` defines core contracts.
3. This skill and its references.
4. Components under `packages/docs/src/components/landing` and `src/app/(site)/_layout`.
5. Outside sites (Poolside, Vercel). Inspiration only; never quote their structure as a rule.

## Routing

This skill owns what is specific to Nyte's site. General craft belongs to the skills below; load
them instead of restating their rules here.

| Need                                                 | Load                                                                                                       |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Hero, landing sections, the plate, nav on the plate  | [references/marketing.md](references/marketing.md), [exemplars/landing-hero.md](exemplars/landing-hero.md) |
| Ethos, manifesto, essays, doc page layout            | [references/long-form.md](references/long-form.md)                                                         |
| Whether a sentence or caption should exist           | `clean-copy`                                                                                               |
| How a sentence reads                                 | `unslop`                                                                                                   |
| Whether a claim or fact pill is true                 | [references/copy.md](references/copy.md)                                                                   |
| A full review across disciplines                     | `better-interface`, which routes to the `better-*` skills                                                  |
| Spacing, alignment, grouping, reading order          | `better-layout`                                                                                            |
| Type scale, wrapping, numerals, font features        | `better-typography`                                                                                        |
| Colour, contrast, tints                              | `better-colors`                                                                                            |
| Radius, shadow, hit areas, motion polish             | `better-ui`                                                                                                |
| Focus, keyboard, reduced motion, accessible names    | `better-accessibility`                                                                                     |
| Long or conflicting Tailwind class lists             | `canonicalize-tailwind`                                                                                    |
| A question none of these answer                      | [references/coverage-gaps.md](references/coverage-gaps.md)                                                 |

When a general skill and a reference here disagree, the reference wins for this site and the
disagreement goes in coverage-gaps.md for the user to settle.

## Verify

1. `pnpm exec turbo typecheck --filter=@nyte-ai/web`, `pnpm lint`, and `pnpm format`.
2. Ask the user to look; dev servers are theirs.
3. Name what still needs eyes: light and dark, 375px and 1440px, reduced motion, keyboard focus
   on every hover effect, and the nav state over each surface it scrolls across.

## Changing this skill

Add a rule only after the user accepts it. Record where it came from in the exemplar or the
reference. A choice nobody has made yet goes in coverage-gaps.md, not in a rule.
