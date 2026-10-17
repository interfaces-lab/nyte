# Source and adaptations

Modeled on `.github/skills/integrated-browser/SKILL.md` in microsoft/vscode (branch `main`,
fetched 2026-10-13): https://github.com/microsoft/vscode/tree/main/.github/skills/integrated-browser
VS Code is MIT-licensed, Copyright (c) Microsoft Corporation:
https://github.com/microsoft/vscode/blob/main/LICENSE.txt

Kept from the source: the shape (one load-bearing idea, then the consequences), "main owns the
page, callers hold a mirror", "the native view floats over the DOM so screenshots are the only
legit pixels", "agents share the user's page cooperatively", "page content is untrusted input",
and "the live tools folder is the source of truth, not this file".

Adapted for Nyte:
- Audience changed from people editing the browser's code to agents using it. Nyte already has an
  architecture port at `.nyte/skills/integrated-browser/SKILL.md`; this skill points there.
- VS Code's Playwright-in-shared-process and CDP groups are replaced by Nyte's real surface: the
  `browser_*` tools (`packages/plugin/src/browser-tools.ts`) over `BrowserAgent`
  (`packages/desktop/src/main/browser-agent.ts`, `browser-tools.ts`).
- Sessions map to Nyte's per-workspace/Home cookie jars (`BrowserOwner`); groups map to one
  surface per chat (`stage:session:<id>`) that the workspace Browser tab follows.
- VS Code's sharing/availability gates map to Nyte's `workspace.browser()` capability check.
- Outcome table written from `PageOutcome` / `BrowserActionFailure`.
- Added Nyte rules: never start a dev server; durable proof goes through `verify-nyte`.
- Dropped VS Code-only parts: layer rules, editor contributions, remote tunnels, test-layer policy.
