Keep experiments here; don't treat prototypes as supported product behavior.
Move accepted implementations into the owning package and document them in the docs site (`@nyte-ai/web`).

## Boundaries

- Nothing imports the lab; the lab may import any package. Turborepo's `lab` tag (`pnpm exec turbo boundaries`) and the no-lab-imports lint rule enforce it.
- A prototype is a route that declares `staticData.prototype`: a title and an icon. The rail lists it and the shell titles its bar with it. Delete the route and its folder to remove one.

## The shell owns the frame

- The lab is flat on the chrome: the rail, the bar and the inspector. The prototype is the one raised, bordered card. Nothing of the lab draws inside the card, and nothing of the prototype draws outside it.
- A page gets exactly this from the shell: the stage (the card), `useScheme`, `useDials`, and core through the app's data layer. Anything else a page needs, it draws inside its card.
- A prototype fills the stage with `flex: 1`, or flows and lets the stage scroll. It never sizes to the viewport: the stage is narrower than the window.
- Display mode and appearance are the app's own preferences, applied by the app's theme boot. Read the mode with `useScheme`; change it from the bar or the Appearance dialog.
- Live controls come from `useDials`, which shows them in the inspector and keeps their values in this browser. Don't import `dialkit` or render a dial root.
- Paint with `@nyte-ai/ui` tokens, so appearance and overrides reach the prototype. Token overrides and free CSS from the inspector live in the address and apply to every element, the shell's own controls included, so a link reproduces the frame.
- Lint enforces this for prototypes: no colour literals, no `document.documentElement`, no `dialkit` or `@nyte-ai/ui/appearance` imports. A surface that isn't Nyte's, such as another product's page, gets a named exception in the lint config.

## Core

- `pnpm dev` opens core from this checkout on first use, from the Core dialog or a prototype that connects through the app's data layer. Its store, secret key, provider logins and MCP config live in the lab's git-ignored `.home`, apart from yours.
- Core reads this checkout and rejects file edits and shell commands.
- Sign in from the Core dialog, or set provider keys in the environment. Plugins that read your real home (Claude Code, ACP, the GitHub CLI) still see it.
- HTTP MCP servers in the lab home's MCP config reach core's sessions, and a page calls them directly at `/core/mcp/<server>/<tool>`.
