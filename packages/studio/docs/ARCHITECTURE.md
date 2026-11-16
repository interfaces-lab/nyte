# Studio architecture

## Constraints and state flow

Keep Swift 6, AppKit, SwiftPM and macOS 26. Keep the existing targets. Lune owns syntax, resolution, layout, geometry and drawing. NyteKit owns host transport. NyteDesign owns tokens and document-free controls. NyteStudio composes them. Follow [AGENTS.md](../AGENTS.md), including main-actor UI, weak closure captures, responder-owned actions and token-only sizes.

`@MainActor @Observable StudioModel` is the project/editor session, not an `NSDocument`. `ProjectStore` owns the source model. The window supplies its undo manager. Host sessions outlive the window. Preserve [SPEC.md](SPEC.md) C01, C08–C09 and E01–E07, [DESIGN.md](DESIGN.md) and [FILES.md](FILES.md).

Components emit callbacks to their panel. Panels send typed `StudioIntent` values to `StudioModel.handle`. The model sends commands down to `ProjectStore` and `CanvasCamera`. Store and host state travels up through Observation. `Observer` delivers derived state back down to views. Panels never call siblings. Do not add Combine, Cocoa bindings or a notification bus.

The model owns `activeFile`, selection and the sheet-scoped entered-instance trail. Remove independently writable selection/context from `CanvasView`. Keep camera state in one main-actor observable `CanvasCamera`; the toolbar observes it rather than storing another zoom.

## Target hierarchy

This is ownership unless marked `ref`. Standard AppKit containers remain code-built.

```text
NSApplication
└─ AppDelegate + MainMenu
   ├─ StudioModel                         project/editor session
   │  ├─ ProjectStore
   │  │  ├─ Lune.Project → ProjectFile → SyntaxTree → SyntaxElement
   │  │  ├─ SheetModel → Sheet → Node
   │  │  │               FrameLayout → LayoutBox
   │  │  ├─ ImageStore
   │  │  └─ EditSession?
   │  ├─ CanvasCamera
   │  ├─ HostClient / HostSocket
   │  └─ SessionDirectory / Transcript
   └─ StudioWindowController              ref StudioModel
      ├─ NSWindow + StudioToolbar → NSToolbar
      │  ├─ sidebar toggle + tracking separator
      │  ├─ project / theme / zoom / zen
      │  └─ tracking separator + Design | Chat + inspector toggle
      ├─ ComposerView                     one instance, window places it
      ├─ StatusViewController             startup/project chooser
      └─ StudioSplitViewController : NSSplitViewController (isVertical: true)
         ├─ SidebarViewController
         │  └─ NSSplitView (isVertical: false; stacked sections)
         │     ├─ FilesSectionViewController → NSOutlineView → SidebarCell
         │     ├─ PagesSectionViewController → NSTableView → SidebarCell
         │     └─ LayersSectionViewController
         │        ├─ SidebarProjection → LayerRow
         │        ├─ NSScrollView → NSOutlineView → SidebarCell
         │        └─ LayerSearchFooter → NSSearchField + filter button
         ├─ WorkbenchViewController
         │  ├─ CanvasView : NSView
         │  │  ├─ FramePresentation[] → content/shadow CALayers
         │  │  └─ CanvasOverlay → outlines/handles/titles/grid/GlowLayer
         │  ├─ CanvasCamera ref
         │  ├─ CanvasToolController → CanvasTool + CanvasGesture
         │  ├─ CanvasHitTester → FrameLayout.hit
         │  ├─ SelectionPolicy
         │  ├─ RenderCoordinator → FrameLayout.surface (Lune renderer)
         │  │                    RenderCache → IOSurface
         │  └─ ComponentBanner / GlassPill / DockView
         │     └─ floating composer slot + status/notice rows
         └─ PanelViewController
            ├─ InspectorViewController → NSScrollView → NSStackView
            │  └─ InspectorSectionController[]
            │     ├─ InspectorHeaderView
            │     └─ InspectorRowView[] → PropertyBinding<Value>
            │        └─ NyteField / SegmentedPicker / MenuButton
            │           NSColorWell / NSSwitch / SourceBox
            └─ ChatViewController
               ├─ chats menu + new-chat/agent buttons
               ├─ NSScrollView → NSStackView
               │  └─ ChatEntry → UserRow / StepsRow / StatusRow / MessageBody
               │     └─ ProseView / CodeBlockView / DiagramBlockView
               ├─ ComposerBox → composer slot
               └─ NSPopover → AgentPanelController
```

The window moves the single composer between slots when visibility changes. Neither panel requests the other's view. Draft and chat state remain model-owned.

## Type contracts

Each cell states one responsibility. `Sources/...` paths below are relative to `packages/studio/`. Existing private decorative views keep their current responsibilities.

| Type | Owns | Told | Tells |
| --- | --- | --- | --- |
| `AppDelegate` | Session and window lifetime | Application lifecycle | Start/close client |
| `MainMenu` | Menu construction | Command selectors | Responder-chain actions |
| `StudioModel` | Active file, selection, edit context, camera, chat and project references | `StudioIntent`, host events | Store commands, observable session state |
| `StudioIntent` | Typed action payload | Component arguments | Model operation |
| `Observer` | Observation registration | Weak update closure | Coalesced main-queue refresh |
| `ProjectStore` | Sources, versions, layout snapshots, places, history, active edit | Edit/watch commands | Revisions, sheets, diagnostics, notices |
| `Project` / `ProjectFile` | Parsed source files | Source text | Scopes and resolved sheets |
| `SyntaxTree` / `SyntaxElement` | Byte spans and authored containment | Parsed bytes | Source-preserving `TextEdit` patches |
| `Sheet` / `Node` | Resolved occurrences and warnings | Project scope | Renderable tree and source references |
| `FrameLayout` / `LayoutBox` | Frozen geometry and text layout | Resolved nodes | Drawing and geometric hit paths |
| `SheetModel` | Published sheet layout and placement | Store rebuild | World-space frame bounds |
| `ImageStore` | Decoded source images | Image requests, file changes | Images and missing-image requests |
| `EditSession` | Frozen targets, baseline text/values/version | Begin, preview, commit, cancel | Preview patches or one final change |
| `ElementRef` / `Occurrence` | Source address / address plus instance trail | Parser/resolver context | Revision-scoped source/occurrence lookup |
| `CanvasSelection` | Sheet, occurrence and revision | Validated pick | Source target and frame lookup |
| `SelectionSnapshot` | Derived targets, values, capabilities | Selection and project revision | Inspector/sidebar inputs |
| `HostClient` / `HostSocket` | Requests, streams, reconnect | Host operations | Typed results and events |
| `SessionDirectory` / `Transcript` | Observable host projections | Reads/events | Sessions, messages, execution state |
| `StudioWindowController` | Window, composer, restoration, undo-manager connection | Session state, menu actions | Shell commands and composer placement |
| `StudioToolbar` | Native toolbar items | Observed session/camera state | Intents and responder actions |
| `StatusViewController` | Startup/chooser controls | Connection phase, workspaces | Retry/open intent |
| `StudioSplitViewController` | Split items, widths, collapse | Shell commands | Actual visibility to model |
| `SidebarViewController` | Section composition | Model and intent closure | Section intents |
| `FilesSectionViewController` | Grouped file list | Project files, active file | Activate-file intent |
| `PagesSectionViewController` | Screen-file index | Files, active file | Activate-file intent |
| `LayersSectionViewController` | Outline, expansion, filter | Projection and selection | Select/reveal/edit intents |
| `SidebarProjection` / `LayerRow` | Derived row identity and source/occurrence mapping | Syntax, resolution, filter | Outline rows and edit capabilities |
| `LayerSearchFooter` | Search/filter controls outside scrolling rows | Current filter | Filter callback |
| `SidebarCell` | Reusable label, icon, badges | Row presentation | Row-control callbacks |
| `WorkbenchViewController` | Canvas collaborators and surrounding chrome | Observed model snapshots | Canvas intents |
| `CanvasView` | First responder and layer hosts | Camera, presentations, overlays | Normalized `CanvasInput` |
| `CanvasInput` | Coordinates, modifiers, click count, event kind | `NSEvent` plus camera conversion | Tool input |
| `CanvasCamera` | Origin, zoom, flights and conversions | Pan/zoom/reveal commands, bounds/backing | Observable viewport |
| `FramePresentation` | Content and shadow layers | Geometry and cached surfaces | No model edits |
| `CanvasOverlay` | Under-content glow, screen-point graphics, shared title layout/picking | Camera, selection, hover, marks | Handle/title hits |
| `CanvasToolController` | Tool, captured gesture, temporary hand | Input and capabilities | Selection/camera/edit intents |
| `CanvasTool` / `CanvasGesture` | Tool choice and associated gesture baselines | Explicit transitions | Current interaction state |
| `CanvasHitTester` | Frame search and coordinate adaptation | World point and layout | Geometric ancestry |
| `SelectionPolicy` | Selection-depth rules | Ancestry, edit context, modifiers | Same target for hover and click |
| `RenderCoordinator` | Worker admission, generations, publication | Layout/viewport changes | Current surfaces on main actor |
| `RenderCache` | Tiered surfaces and retirement | Revision/scale/region keys | Reused surfaces |
| `ComponentBanner` / `GlassPill` / `DockView` | Canvas chrome, composer slot, notice/status rows | Presentation values | Ask/stop/dismiss/show-chat callbacks |
| `PanelViewController` | Design/chat children and visibility | `model.panel` | Visibility acknowledgement |
| `InspectorViewController` | Ordered sections and shared layout guides | Selection snapshot | Property intents |
| `SectionDescriptor` / `SectionID` / `RowDescriptor` | Stable section keys, predicates, typed rows | Code-defined declarations | Section construction |
| `InspectorSectionController` | Header, rows, bindings, local collapse | Descriptor and snapshot | Binding intents |
| `InspectorHeaderView` / `InspectorRowView` | Header actions and aligned caption/control slots | Labels, controls, token metrics | Control callbacks |
| `PropertyDescriptor<Value>` | Read/parse/format/validate/patch rules | Authored and effective values | Typed values and patches |
| `PropertyBinding<Value>` / `SelectionValue<Value>` | Aggregation and edit lifecycle | Snapshot, field events | Model edit intents |
| `NyteField` | Draft, focus, stepping, scrub events | Display state and numeric policy | Begin/preview/commit/cancel callbacks |
| `SegmentedPicker` / `MenuButton` | Choice presentation | Options, selected/mixed/enabled state | Choice callback |
| `SourceBox` | Source excerpt presentation | Markup | No edits |
| `ChatViewController` | Transcript rows, chat menu, composer slot, agent popover | Observed chat state | Session/send/stop/focus intents |
| `ChatEntry` | Transcript row projection | Transcript | Stable row descriptions |
| `UserRow` / `StepsRow` / `StatusRow` | Message, step disclosure, status presentation | Row values | Local disclosure callbacks |
| `MessageBody` / `ProseView` / `CodeBlockView` / `DiagramBlockView` | Native message rendering | Markdown blocks | Copy/link/local display actions |
| `ComposerBox` | Composer container | Shared composer | No session operations |
| `ComposerView` | Input controls and local text undo | Draft, selection excerpt, connectivity | Draft/send/stop/focus intents |
| `AgentPanelController` | Connection/provider/skill controls | Host state | Install/handoff intents |

Move unseen-chat bookkeeping from `PanelViewController` into `StudioModel`, so hidden views do not own session facts.

## Three trees and identity

```text
Authored: Project.files → SyntaxTree.roots → SyntaxElement.children
Resolved: Project.sheet → Sheet.frames → Node.children → layout
Sidebar:  files index + screen index + active file's Layers projection
```

`<use src>` imports declarations. Uppercase tags such as `<Button>` instantiate them. Expansion does not add authored children. Preserve `site`, `origin`, `definition` and `trail` from [Resolve.swift](../Sources/Lune/Resolve.swift). Edit the selected occurrence's source element, not its outer diagnostic `Node.site`. An instance row targets its caller element; entering its root uses the `Node.componentRoot` definition alias.

```text
Authored Home.lune: Button at A; Button at B. Button.lune defines text T.
Resolved Home:      instance A → (T, trail: [A])
                    instance B → (T, trail: [B])
Sidebar Layers:    rows A/B; disclosure adds those distinct virtual T rows.
```

Files keeps the flat Controls/Blocks/Screens/Other grouping. Pages derives a screen-file jump list, not another selection domain. Activation moves the camera, never unloads other sheets. Layers projects the active file's authored frame subtrees. Imports, tokens and component declarations remain file context. Instance disclosure adds distinguished resolved rows. These can select and enter definition editing, but cannot reparent imported children. Hidden authored rows remain selectable without a `LayoutBox`. Filters retain ancestors. Display siblings front-to-back; future drops translate to source order.

`Occurrence(element, trail)` distinguishes instances within a snapshot. It is not durable: [ElementRef](../Sources/Lune/Project.swift) contains positional indices. Keep the shape, revision-tag selection/projections, and derive frame indices. Value-only edits retain addresses and row IDs. Structural commands must return an address remap; external structural changes clear affected selection, edit context and expansion. If correspondence is uncertain, clear rather than guess. Never persist spans or frame indices as identity. Synthetic placeholder labels are not selectable rows. Do not add an ID syntax in this refactor. Sketch's corresponding distinctions are in `model.md` §§2–3.

## Canvas tools and edits

Keep one canvas `NSView`, not one view per element. Route captured gestures first, temporary hand second, then overlay hits and the active tool. `SelectionPolicy` implements SPEC C08, not Sketch's inferred group defaults. Double-click enters an instance; Command-click selects deeply; Escape steps out when idle. Text double-click focuses the inspector caret, per C10. Hover uses identical policy and modifiers. The banner names the definition file and counts by definition reference, not component name. Start with existing box/clip geometry, not a new path-picking engine. See `canvas.md` §§2–4.

| Tool/state | Event | Transition/action |
| --- | --- | --- |
| Select/idle | Down on object/empty space; handle | Pressed; resizing on handle; capture baseline |
| Select/pressed | Cross token-defined drag threshold | Moving if capability permits; empty-space press becomes marquee |
| Select/pressed | Up below threshold | Click selection; idle |
| Moving/resizing | Drag or modifiers | Preview from baseline, never previous preview |
| Marquee | Drag / up | Preview / finalize selection, no source undo |
| Moving/resizing | Up | Commit once; idle |
| Any captured edit | Escape, focus loss, project/selection change | Cancel preview; idle |
| Hand/idle | Down, drag, up | Panning, update camera, idle; no source undo |
| Idle | Space held / middle down | Temporary hand; restore previous tool on release |
| Captured gesture | Tool change | Cancel first; then change tool |
| Insert, later | Down, drag, up / Escape | Preview new geometry, one insertion / cancel |

Clear held tools on responder/window focus loss. Do not replace an active drag with temporary pan. Releasing Space during pan defers restoration until mouse-up. Keep frame movement first; moving flow children waits for explicit layout-reorder semantics.

`ProjectStore.beginEdit` freezes source targets, text and expected versions in one active `EditSession`. Preview reparses baseline patches in memory and invalidates dependents without saving. Commit registers one before/after undo and queues one version-checked write. An unchanged result adds no history. Cancel restores baseline. A stale write publishes outside text, removes the rejected undo entry and raises a notice. Outside changes cancel the preview and drop that file's history, as E02–E03 require. Selection changes cancel before retargeting. Deduplicate source targets reached through multiple occurrences. Initially reject edits spanning source files: `HostClient.write` has no multi-file transaction.

Extract rendering without replacing it. Preserve thumbnail/base/detail IOSurfaces, bounded workers and volatile retirement from [CanvasView.swift](../Sources/NyteStudio/CanvasView.swift). Freeze layouts before worker publication. Key work by project, frame occurrence, content/preview revision, raster scale, backing scale, region and color space; reject obsolete results. Selection invalidates overlays only. Pan reuses surfaces. Glow stays below content; handles and titles stay above it. Keep demand-driven scheduling, supported by `canvas.md` §§1, 5.

## Inspector descriptors and bindings

Use Swift-shaped declarations, not reflection or a section plugin system:

```text
SectionDescriptor {
  id: SectionID, title: String
  available: (SelectionSnapshot) -> Bool
  rows: [RowDescriptor]
}
RowDescriptor = text | number | pair | choice | menu | toggle | color | custom
  each case carries its typed PropertyDescriptor and control configuration
PropertyDescriptor<Value> = read + parse + format + validate + makePatch
PropertyBinding<Value> = descriptor + snapshot + send(StudioIntent)
  read(), submit(Value), begin(), preview(transform), commit(), cancel()
SelectionValue<Value> = none | uniform(Value) | mixed | unavailable
```

`none` means no selection; `unavailable` means unsupported or uneditable targets. `mixed` is not an empty string or numeric sentinel. Aggregate authored values separately from effective defaults, so tokens remain names. Invalid draft text belongs to `NyteField`, not selection state.

Keep ordered selection/component, text/icon/image, size, layout, appearance, shadow and source sections. Add imports later. Reconcile sections by ID; update values without rebuilding focused controls. Shared guides align captions and paired fields using Nyte tokens, not recovered Sketch constants.

Scrub begin freezes targets and originals. Preview applies a delta to each original, including mixed selections. Commit finishes that same session once; cancel writes nothing. Return/text-field focus loss submits parsed text once; focus loss during a scrub cancels it. Preserve native field-editor typing undo. For color, begin on well activation, preview its actions and commit on deliberate deactivation/panel close. Selection changes cancel. Remove the delayed commit. These are our contracts; `inspector.md` §§1–3 does not establish Sketch's complete cancellation policy.

## What we do not copy

Reports live under `~/.cache/nyte-studio/sketch-re/`. They describe static evidence, not tested live behavior. Their recommendation sections are proposals, not findings.

| Sketch mechanism | Studio decision and reason | Evidence |
| --- | --- | --- |
| `NSDocument`, archives, tabs | Keep host-backed `ProjectStore`; one folder, one window, checked writes already own persistence | `shell.md` §§1, 5; `model.md` §1 |
| Panel-local custom toolbar controllers | Keep `NSToolbar` and tracking separators; SPEC W01 requires one native row | `shell.md` §1, toolbar subsection |
| Stored pages and Components-page helper | Pages is a screen-file index; files already own content | `model.md` §§1, 4 |
| Symbol registry and deep instance overrides | Keep imports/props and explicit definition edits; C09 changes every occurrence | `model.md` §2 |
| Metal tiles and retained Marina scene | Keep Core Graphics/CA surface tiers; no demonstrated need for another renderer | `canvas.md` §§1, 5 |
| Dispatcher/store per section and legacy KVO | Keep Observation plus typed bindings; avoid duplicate state machinery | `inspector.md` §§1, 3 |
| SwiftUI color/pinning islands | Keep native AppKit controls, including system color well; SwiftUI is forbidden | `inspector.md` §2 |
| Collaboration-aware snapshot history | Keep source transactions and window undo; host writes already check versions | `shell.md` §4; `model.md` §1 |

## Gap and build order

Each row is a useful checkpoint. Preserve existing behavior before adding authoring features.

| Phase | Current type/file | Target | Change and checkpoint |
| --- | --- | --- | --- |
| 1 | `StudioModel` in [Sources/NyteStudio/StudioModel.swift](../Sources/NyteStudio/StudioModel.swift), `Observer` in [Observe.swift](../Sources/NyteStudio/Observe.swift), [PanelViewController.swift](../Sources/NyteStudio/PanelViewController.swift) | Same + `StudioIntent`, `SelectionSnapshot` | Keep observation; new intent/snapshot values; centralize selection/active file and unseen-chat writes |
| 1 | `CanvasSelection` in [CanvasView.swift](../Sources/NyteStudio/CanvasView.swift), `Occurrence` in [Sources/Lune/Resolve.swift](../Sources/Lune/Resolve.swift), `ElementRef` in [Project.swift](../Sources/Lune/Project.swift) | Revision-validated selection | Keep occurrence shape; remove frame index as identity; stale picks cannot retarget edits |
| 1 | `dragTree`, `stage/commitStaged` in [StudioModel.swift](../Sources/NyteStudio/StudioModel.swift) / [ProjectStore.swift](../Sources/NyteStudio/ProjectStore.swift) | Store-owned `EditSession` | Split; add begin/cancel and version capture; drag, cancel, external change and undo work before extraction |
| 2 | `SidesViewController` and window in [StudioWindowController.swift](../Sources/NyteStudio/StudioWindowController.swift), [StudioToolbar.swift](../Sources/NyteStudio/StudioToolbar.swift) | `StudioSplitViewController`, same shell/toolbar | Rename private split; keep native separators, restore widths and pre-zen state |
| 2 | [WorkbenchViewController.swift](../Sources/NyteStudio/WorkbenchViewController.swift), [ChatViewController.swift](../Sources/NyteStudio/ChatViewController.swift), [ComposerView.swift](../Sources/NyteStudio/ComposerView.swift) | Window-owned shared composer | Split hosting from chat state; move one view between slots without losing draft/focus |
| 3 | Inspector `build/fill/row` in [InspectorViewController.swift](../Sources/NyteStudio/InspectorViewController.swift) | Descriptors, section/row controllers, bindings | Split one section at a time, size first; preserve source spelling and focused drafts |
| 3 | `NyteField` in [Sources/NyteDesign/Controls.swift](../Sources/NyteDesign/Controls.swift), pickers in [Pickers.swift](../Sources/NyteDesign/Pickers.swift) | Same controls | Keep; add lifecycle and mixed/unavailable display; scrub and color edit commit once |
| 4 | Camera, `Artboard`, raster methods in [CanvasView.swift](../Sources/NyteStudio/CanvasView.swift) | `CanvasCamera`, `FramePresentation`, `RenderCoordinator`, `RenderCache` | Split sequentially; preserve flights, tier budgets and stale-work cancellation |
| 4 | Overlay, hit, input methods in [CanvasView.swift](../Sources/NyteStudio/CanvasView.swift), [Sources/Lune/Geometry.swift](../Sources/Lune/Geometry.swift) | `CanvasOverlay`, `CanvasHitTester`, `SelectionPolicy`, `CanvasToolController` | Split; keep geometry in Lune and policy in app; hover/click and temporary tools agree |
| 5 | [SidebarViewController.swift](../Sources/NyteStudio/SidebarViewController.swift) | Files/Pages/Layers children, projection, fixed footer | Split files first; chat menu already lists sessions; add screen index, then selectable layers and filtering |
| 5 | Singular `selection`, private `Drag` | Selection collection, marquee states | Extend after shared editing works; mixed fields aggregate unique same-file targets |
| Later | [Sources/Lune/Patch.swift](../Sources/Lune/Patch.swift), tool controller | Structural edit commands, insert tool | Keep byte patcher; add address remapping before insert/reorder tools; prohibit resolved-child reorder |

After each implementation phase run `pnpm --dir packages/studio typecheck` and `pnpm --dir packages/studio build`. Replay select/enter/escape, edit/undo/external-write, pan/zoom, panel/zen and chat reconnect journeys. This document changes no source and claims no new runtime verification.
