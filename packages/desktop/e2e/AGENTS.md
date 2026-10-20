# Desktop E2E tests

Playwright tests for the Electron app. Read `README.md` for how to run them.

- One spec file is one chapter over one surface, launched through `launch.ts`; a chapter must pass on its own. Shared locators live in `ui.ts`.
- No real providers. The desktop runs under an isolated `HOME`.
- Collect errors on any page a test opens with `collectErrors` from `errors.ts`, and assert them.
