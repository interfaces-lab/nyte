# Desktop browser panel

Desktop shows web pages as native `WebContentsView`s above the app's DOM. Read `.agents/skills/integrated-browser/SKILL.md` first; its Testing section says which test proves an overlay or occlusion change.

`packages/desktop/e2e/browser.spec.ts` › "the integrated browser journey" serves a local HTTP fixture and walks the panel in named steps, checking guest URL, title and loading state through Electron.

## Gotchas

- DOM screenshots miss native views. Capture the window.
- The step "pause and restore blocking for this host" is `test.step.skip`. The rest of the journey does not exercise it.
- Guest-state assertions do not prove the composited page pixels.
