# Desktop startup verification

Five interleaved, isolated production launches per version on macOS using fresh app-data and NYTE_HOME directories. Times are relative to renderer navigation, not process launch. Baseline is the pre-change desktop source from HEAD, built against the current workspace dependencies; its sandbox preload excludes the protocol package so it can run with those dependencies.

| Median | Baseline | Current |
| --- | ---: | ---: |
| First contentful paint | 172 ms | 96 ms |
| Populated shell | 216.3 ms | 220.3 ms |

First paint is 44% earlier and the populated shell is below the 500 ms target. Populated-shell timing is effectively unchanged; the earlier paint is the static splash. The current shell mounts with local resources already cached. No desktop-owned lazy() or dynamic import() remains; the build checks for these and bounds startup bundle sizes.

Two independently expanded folders with 12 threads each: first folder showed all 12 rows in 6.5 ms; second expansion left both open with 24 rows at 23 ms. Neither mutation contained a loading state. Host selection stayed Home. A backend test also verifies session access and watches survive selecting another workspace.

StyleX: 44 measured elements across landing/composer, settings, and workbench in both themes retain baseline geometry. Dark styles match exactly. Development CSS smoke checks match that geometry and typography. Light colors intentionally change to the supplied reference: sidebar #ebebed, chat #f5f5f6, composer/editor #fcfcfc, selected row rendered #dedee0. These four screenshot samples match the supplied reference exactly.

Bundled syntax worker ran under production Electron CSP, returned highlighted TypeScript, and preserved escaped script-tag text. Production build, TypeScript, changed-code lint, and 102 tests (19 files) passed. Final startup entries: main 841.2 KiB, preload 3.4 KiB, renderer 3889.1 KiB.

Raw timing, folder observations, computed styles, and screenshots are alongside this report. Measurements are local fixtures, not a claim about every machine or large workspace registry.
