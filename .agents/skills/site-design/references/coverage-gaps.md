# Coverage gaps

Choices nobody has made yet. Do not invent a rule for these; raise them with the user, then move
the accepted answer into a reference.

- **Ethos and manifesto.** Where the drafts live, their URLs (for example `/vision/ethos` and
  `/vision/manifesto`), whether they get their own layout or reuse `DocArticle`, and who signs
  them.
- **Sections below the hero.** Only `InstallCard` exists. No pattern yet for feature, proof, or
  changelog sections.
- **Touch.** On touch screens a fact word navigates on tap, so its pills are never seen. Decide
  whether touch gets the pills.
- **Dark mode preview.** `Bezel` glass was drawn for the blue plate; check it on the dark panel.
- **Typography outside the hero.** Geist Pixel is used only in the hero headline. Undecided
  whether essays or section titles use it.
- **Mechanical checks.** The `nyte-design` and `nyte-interactions` Oxlint plugins in
  `oxlint.config.ts` enforce spacing, size, colour, and control rules for `packages/app`,
  `packages/ui`, and `packages/lab`. Nothing enforces a rule on `packages/docs` yet.
- **`better-writing`.** `better-interface` routes copy to a `better-writing` skill that does not
  exist. Use `clean-copy` and `unslop` for that step.
