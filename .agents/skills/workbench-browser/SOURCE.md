# Source

Modeled on the integrated-browser skill in microsoft/vscode (branch `main`, fetched
2026-10-13): https://github.com/microsoft/vscode/tree/main/.github/skills/integrated-browser.
VS Code is MIT-licensed, Copyright (c) Microsoft Corporation:
https://github.com/microsoft/vscode/blob/main/LICENSE.txt

This skill took the upstream shape and retargeted it from editing the browser's code to using
it; the code side lives in the integrated-browser skill. The VS Code-only parts were dropped:
Playwright in the shared process, layer rules, editor contributions, remote tunnels and
test-layer policy.
