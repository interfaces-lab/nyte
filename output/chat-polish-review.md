# Chat polish review

Applied [make-interfaces-feel-better](https://github.com/jakubkrehel/make-interfaces-feel-better/tree/main/skills/make-interfaces-feel-better) to desktop chat on 2026-09-04.

Mode: full. React, existing StyleX styles and tokens, Nyte UI components backed by Base UI. Cursor remains the visual reference. No new styling system, animation dependency, or effect audit.

Scope: transcript typography, skill text, message editing, composer controls and attachments, slash/mention suggestions, preview cards, and code-copy control. Settings and sidebar changes are excluded. The repository moved from uji to nyte during this work.

## Coverage

| Category | Evidence inspected | Result |
| --- | --- | --- |
| Typography | Cursor bundled markdown styles; Prose in both streaming/static modes; shared chat styles; Appearance font variables | Updated and rendered in a local preview |
| Surfaces | Composer and suggestion geometry; floating-surface frame; thumbnail boundaries; diff clipping | Updated suggestion corners and image outlines; retained existing shared shadows |
| Animations | Suggestion preview state styles; menu, reasoning, and work-group transitions | Removed repeated preview zoom; other animations unchanged |
| Icons | Composer and code-copy icon usage, labels, currentColor inheritance | Existing icon set retained; code-copy now uses Nyte UI Button |
| Performance | Streamdown render modes, explicit transition properties, layout under font changes | Streaming/static block positions matched; no new motion or effect machinery |

## Changes

Paths below are relative to packages/desktop/src/renderer/src.

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| Medium | conversation/styles.stylex.ts:34; conversation/prose.tsx | Flex gaps combined with negative paragraph/list margins; oversized headings | Normal block flow, context-sensitive margins, smaller heading hierarchy | Nested prose needs predictable spacing and alignment |
| Medium | conversation/styles.stylex.ts:76 | Wide, faint inline-code boxes and permanent link underlines | 2px horizontal code padding, inset highlight, inherited leading, hover highlight/underline, no double highlight inside links | Keep text and references on the same baseline |
| Medium | conversation/styles.stylex.ts:165; conversation/composer.tsx:597; conversation/turn-view.tsx:75; conversation/transcript-presentation.ts:80 | Transcript skills were small grey dollar-prefixed badges | Shared amber slash-prefixed text at the surrounding font size; persisted prompt unchanged | The same reference should read consistently in composer and transcript |
| Medium | conversation/styles.stylex.ts:1172; theme/vars.stylex.ts; theme/tokens.css | Mention leading differed from input leading; chat tracking was inconsistent | Shared chat leading and tracking; UI and code sizes still use Appearance variables | Font settings should scale related text together |
| Medium | conversation/styles.stylex.ts:596 | Fixed 28px suggestion height, 8px inner radius, unshrinkable names, faint descriptions | Minimum height that grows with fonts, 6px inner radius within 12px/6px frame, ellipsis, stronger description contrast | Prevent clipping and mismatched nested corners |
| Medium | conversation/styles.stylex.ts:520; conversation/styles.stylex.ts:367 | Small send/add and attachment-remove targets | 40px hit areas without increasing visible controls; send/add use 44px on coarse pointers | Improve pointer access while preserving compact layout |
| Medium | conversation/styles.stylex.ts:693 | Preview zoom and fade replayed as selection changed | Immediate preview updates, without scale or transition | Repeated navigation should not make text move |
| Low | conversation/styles.stylex.ts:348; theme/tokens.css | White thumbnails could disappear into their background | Inset neutral black/white 10% outline | Separate images without changing dimensions or tinting their edges |
| Low | conversation/styles.stylex.ts:729 | Short preview descriptions could leave orphaned words | Pretty wrapping on preview descriptions only | Improve short copy without rewrapping streaming responses |
| Medium | conversation/code-block.tsx:188 | Standalone native copy button | Unstyled Nyte UI Button with existing label and focus treatment | Keep reusable control behavior in the shared UI package |
| High, fixed | conversation/turn-view.tsx:154 | Saving unchanged text discarded model-only changes | Resend uses the chosen branch model even when text is unchanged | Editing is also a model-aware branch operation |

## Considered but rejected

| Location | Candidate | Rejected because |
| --- | --- | --- |
| Chat prose | Pretty wrapping on all streaming text | Avoid reflowing earlier lines while tokens arrive; short preview copy gets it instead |
| Composer/model menus | Spring, blur, and press-scale effects on repeated actions | Cursor parity and frequent keyboard use call for restrained, immediate feedback |
| Floating menus/diffs | Stronger shadows or replacement of structural borders | Shared shadows already own elevation; separators and focus boundaries communicate structure |
| Dense code toolbar | Uniform 40px visible controls everywhere | This would enlarge the compact reference layout; invisible targets must not cover selectable code or neighboring controls |

## Verification

- Local browser preview compiled the actual StyleX files and rendered the real Prose component. The composer/menu geometry sample used those compiled styles, not a running Electron session.
- Streaming and static markdown produced identical measured block positions for headings, paragraphs, nested lists, blockquotes, and a table.
- Default prose was 14px/22px and code 12px. With UI size 16 and code size 15, prose and skill text became 17px/25px and code became 15px with inherited leading.
- Link hover showed its subtle background and underline with 2px underline offset.
- At UI size 20, suggestion rows grew to 33px and long names did not overflow.
- Measured send/add and remove pseudo-elements were 40px square. The sample checked pointer access and neighboring control geometry.
- Preview starting state computed scale none, opacity 1, transition 0s, and zero animations. No slowed replay is needed for the removed motion. Unchanged menu/chevron motion was not replayed at 10% speed.
- Existing focused suite: 20 tests passed across transcript presentation, model-picker state, plugin commands, and workbench controller. No new tests added in this pass.
- Focused lint on changed UI component/style files passed. Existing transcript error-parsing helpers still have anti-slop findings in the root run.
- Root pnpm format passed initially; its final rerun flagged the concurrently edited packages/core/test/kernel/sdk-model-config.test.ts. Changed chat files pass their formatting check. Root pnpm lint failed on existing findings across the workspace. Root pnpm typecheck failed on unresolved legacy core imports.
- Desktop typechecking passed before a concurrent core shape change. The later check reported missing RunInfo.config in chrome/sidebar-filter.test.ts:31.

## Verdict

Needs changes before claiming whole-chat parity. The changes above are implemented, but end-to-end Electron focus, model-only resend, real slash/mention data loading, narrow-window collision handling, and unchanged menu motion have not been reverified in the relocated workspace. The local style preview does not substitute for those checks.

## Follow-up: workbench, navigation, settings, and notifications

Implemented on 2026-09-04 after the scope expanded:

- Titlebar and workbench rail share one expand/collapse action. Browser history and the Changes file tree have independent panel-local visibility. Removed the duplicate inset workbench close action and “Apps” label.
- Browser history records completed visits and reopens them without replacing the selected panel. Address focus selects the expanded URL after the controlled value updates.
- New Chat always shows a spaced, monospace shortcut; Search retains its separate hover-only shortcut. The palette has roomier themed input, tabs, and results.
- Footer gear toggles Settings and restores the prior view. Removed the unavailable Docs item. Floating shadows now belong to the popup, eliminating the separately lingering shadow layer.
- Settings cards share a surface and dividers. Model selectors stay single-line; provider model groups start collapsed, search reveals matching models, and clearing search restores expansion choices.
- Settings font controls enumerate installed macOS sans and fixed-pitch families, preview each family, and include live UI/code samples. Font smoothing and saved local typefaces apply to the previews.
- Replaced the hand-built folder-error status with Sonner through the Nyte UI package boundary. One themed toaster handles notifications; workspace trust remains an explicit dialog.
- Chat-row selection now uses the 7% selection fill instead of the 14% pressed fill. The preview uses compact text, an 8px radius, a 4px row-to-card gap, and a single-line path.

### Follow-up verification

Used a separate Electron instance and app-data directory, with the actual renderer and host. No credentials, model requests, or workspace trust grants were changed by these checks.

- Titlebar/rail restoration and Browser's independent history toggle passed. Browser history reopened a completed visit and survived workbench collapse.
- Footer Settings toggle, Docs removal, and popup/shadow dismissal passed.
- Palette typing, keyboard selection, Escape dismissal, and persistent New Chat shortcut passed. The palette was inspected at a narrow width with enlarged interface text.
- Model groups expanded, filtered to Opus matches, and restored their prior expansion after clearing the query. Card-color equality and selector vertical centering passed at 1200, 900, and 640 CSS pixels.
- Native discovery returned 86 sans and 12 fixed-pitch families on this Mac, including Berkeley Mono and MonoLisa. Selecting Avenir and Berkeley Mono persisted across a renderer reload. The nested code sample uses the chosen family; smoothing toggled between antialiased and auto.
- Sonner's light/dark backgrounds and description colors matched the current tokens; the selected Avenir font, 12px radius, layer 75, and 150ms transition applied. Reduced motion computed to zero seconds, and dismissal removed the notification.
- A sample chat rendered with the real preview component and row styles measured a 4px gap, -4px top offset, and -1px title offset. This was a component geometry check, not an end-to-end session/drag test.
- The focused suite has 24 passing tests. Desktop typechecking and touched-file formatting/lint pass. The coordinated Sonner task reports a passing production build at 1298.9 KiB initial renderer JavaScript, below the unchanged 1300 KiB budget.

The original whole-chat parity caveat still applies to model-only resend, full slash/mention data loading, and transcript scrolling. Those were not exercised in this follow-up.
