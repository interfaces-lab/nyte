# Desktop browser panel

Desktop shows web pages as native `WebContentsView`s above the app's DOM.

## Sub-features

- `open`: a page opens in a panel.
- `overlay`: popups and trays that may overlap a page still render on top.

## How to get to it (user POV)

- Desktop app: open a browser panel from the workspace.

## Driving it with Playwright (desktop project)

Preconditions: `pnpm e2e:desktop` builds; read `.nyte/skills/integrated-browser/SKILL.md` first.

- Use `packages/desktop/e2e/browser.spec.ts`. It starts a local HTTP fixture, opens the
  workbench, focuses the `Address` combobox, navigates, and checks guest URL, title and loading
  state through Electron. It also covers downloads, shortcuts, authentication and crash recovery.
- Overlay: open a floating surface over the page and observe guest visibility and actual window
  composition. The app's occlusion list lives in `packages/app/src/components/overlay-occlusion.ts`.

## Gotchas

- DOM screenshots miss native views. Capture the window.
- The blocking-toggle step is skipped at audit time. Do not count it as exercised by the rest
  of the browser journey.
- Existing guest-state assertions do not by themselves prove the composited page pixels.
