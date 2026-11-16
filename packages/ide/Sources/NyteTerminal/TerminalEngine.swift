import Darwin
import GhosttyVt
import os

final class TerminalEngine {
    static let holdLimit: UInt64 = 1_000_000_000
    private(set) var grid: TerminalGrid
    private(set) var title: String?
    private(set) var directory: String?
    private var isDark: Bool
    private var effects = TerminalEffects()
    private var forceFull = true
    private var holdStarted: UInt64?
    private(set) var optionAsMeta = TerminalPreferences.OptionKey.left
    private var outputStart: GhosttyTrackedGridRef?
    private var outputEnd: GhosttyTrackedGridRef?
    let terminal: GhosttyTerminal
    private let renderState: GhosttyRenderState
    private var rowIterator: GhosttyRenderStateRowIterator?
    private var rowCells: GhosttyRenderStateRowCells?
    let keyEncoder: GhosttyKeyEncoder
    let keyEvent: GhosttyKeyEvent
    let mouseEncoder: GhosttyMouseEncoder
    let mouseEvent: GhosttyMouseEvent
    private let gesture: GhosttySelectionGesture
    private let gesturePress: GhosttySelectionGestureEvent
    private let gestureDrag: GhosttySelectionGestureEvent
    private let gestureRelease: GhosttySelectionGestureEvent
    private static let signposter = OSSignposter(subsystem: "ai.nyte.ide", category: "terminal")
    private static let version: StaticString = "NyteIDE"

    init(grid: TerminalGrid, colors: TerminalColors, preferences: TerminalPreferences) throws(TerminalFailure) {
        var undo: [() -> Void] = []
        var built = false
        defer { if !built { undo.reversed().forEach { $0() } } }
        func own(_ name: String, _ make: (inout OpaquePointer?) -> GhosttyResult,
                 _ free: @escaping (OpaquePointer?) -> Void) throws(TerminalFailure) -> OpaquePointer {
            var handle: OpaquePointer?
            let result = make(&handle)
            guard result == GHOSTTY_SUCCESS, let handle else {
                let reason = Self.describe(result == GHOSTTY_SUCCESS ? GHOSTTY_OUT_OF_MEMORY : result)
                throw .library(operation: "Creating the \(name)", reason: reason)
            }
            undo.append { free(handle) }
            return handle
        }
        let terminal = try own("terminal", { ghostty_terminal_new(nil, &$0, grid.columns, grid.rows) }, ghostty_terminal_free)
        renderState = try own("render state", { ghostty_render_state_new(nil, &$0) }, ghostty_render_state_free)
        rowIterator = try own("row iterator", { ghostty_render_state_row_iterator_new(nil, &$0) }, ghostty_render_state_row_iterator_free)
        rowCells = try own("row cells", { ghostty_render_state_row_cells_new(nil, &$0) }, ghostty_render_state_row_cells_free)
        keyEncoder = try own("key encoder", { ghostty_key_encoder_new(nil, &$0) }, ghostty_key_encoder_free)
        keyEvent = try own("key event", { ghostty_key_event_new(nil, &$0) }, ghostty_key_event_free)
        mouseEncoder = try own("mouse encoder", { ghostty_mouse_encoder_new(nil, &$0) }, ghostty_mouse_encoder_free)
        mouseEvent = try own("mouse event", { ghostty_mouse_event_new(nil, &$0) }, ghostty_mouse_event_free)
        gesture = try own("gesture", { ghostty_selection_gesture_new(nil, &$0) }, { ghostty_selection_gesture_free($0, terminal) })
        let events = try [GHOSTTY_SELECTION_GESTURE_EVENT_TYPE_PRESS, GHOSTTY_SELECTION_GESTURE_EVENT_TYPE_DRAG,
                          GHOSTTY_SELECTION_GESTURE_EVENT_TYPE_RELEASE].map { kind throws(TerminalFailure) in
            try own("selection event", { ghostty_selection_gesture_event_new(nil, &$0, kind) }, ghostty_selection_gesture_event_free)
        }
        self.terminal = terminal
        (gesturePress, gestureDrag, gestureRelease) = (events[0], events[1], events[2])
        self.grid = grid
        isDark = colors.isDark
        built = true

        installCallbacks()
        func configure<Value>(_ option: GhosttyTerminalOption, _ value: Value, _ name: String) throws(TerminalFailure) {
            var value = value
            let result = withUnsafePointer(to: &value) { ghostty_terminal_set(terminal, option, $0) }
            guard result == GHOSTTY_SUCCESS else { throw .library(operation: name, reason: Self.describe(result)) }
        }
        try configure(GHOSTTY_TERMINAL_OPT_SCROLLBACK_MAX_LINES, preferences.scrollbackLines, "scrollback lines")
        try configure(GHOSTTY_TERMINAL_OPT_SCROLLBACK_MAX_BYTES, Int.max, "scrollback bytes")
        try configure(GHOSTTY_TERMINAL_OPT_MODE_DEFAULT, GhosttyTerminalModeConfig(mode: ghostty_mode_new(2027, false), value: true), "modes")
        let resized = ghostty_terminal_resize(terminal, grid.columns, grid.rows, grid.cellWidth, grid.cellHeight)
        guard resized == GHOSTTY_SUCCESS else { throw .library(operation: "ghostty_terminal_resize", reason: Self.describe(resized)) }
        _ = setColors(colors)
        apply(preferences)
    }

    func apply(_ preferences: TerminalPreferences) {
        optionAsMeta = preferences.optionAsMeta
        var lines = preferences.scrollbackLines
        var blink = preferences.cursorBlinks
        var style: GhosttyCursorStyle = switch preferences.cursorStyle {
        case .block: GHOSTTY_CURSOR_STYLE_BLOCK
        case .bar: GHOSTTY_CURSOR_STYLE_BAR
        case .underline: GHOSTTY_CURSOR_STYLE_UNDERLINE
        }
        set(GHOSTTY_TERMINAL_OPT_SCROLLBACK_MAX_LINES, &lines, "scrollback lines")
        set(GHOSTTY_TERMINAL_OPT_DEFAULT_CURSOR_STYLE, &style, "cursor style")
        set(GHOSTTY_TERMINAL_OPT_DEFAULT_CURSOR_BLINK, &blink, "cursor blink")
        forceFull = true
    }

    deinit {
        ghostty_tracked_grid_ref_free(outputStart)
        ghostty_tracked_grid_ref_free(outputEnd)
        ghostty_selection_gesture_free(gesture, terminal)
        [gesturePress, gestureDrag, gestureRelease].forEach { ghostty_selection_gesture_event_free($0) }
        ghostty_mouse_event_free(mouseEvent)
        ghostty_mouse_encoder_free(mouseEncoder)
        ghostty_key_event_free(keyEvent)
        ghostty_key_encoder_free(keyEncoder)
        ghostty_render_state_row_cells_free(rowCells)
        ghostty_render_state_row_iterator_free(rowIterator)
        ghostty_render_state_free(renderState)
        ghostty_terminal_free(terminal)
    }

    func write(_ bytes: UnsafeRawBufferPointer) -> TerminalEffects {
        guard let base = bytes.baseAddress, !bytes.isEmpty else { return TerminalEffects() }
        effects = TerminalEffects()
        defer { effects = TerminalEffects() }
        ghostty_terminal_vt_write(terminal, base.assumingMemoryBound(to: UInt8.self), bytes.count)
        return effects
    }

    func resize(_ next: TerminalGrid) {
        guard next != grid else { return }
        grid = next
        Self.check(ghostty_terminal_resize(terminal, next.columns, next.rows, next.cellWidth, next.cellHeight), "resize")
        holdStarted = nil
        forceFull = true
    }

    func setColors(_ colors: TerminalColors) -> [UInt8] {
        let schemeChanged = colors.isDark != isDark
        isDark = colors.isDark
        assign(GHOSTTY_TERMINAL_OPT_COLOR_FOREGROUND, Self.rgb(colors.foreground), "foreground colour")
        assign(GHOSTTY_TERMINAL_OPT_COLOR_BACKGROUND, Self.rgb(colors.background), "background colour")
        assign(GHOSTTY_TERMINAL_OPT_COLOR_CURSOR, Self.rgb(colors.cursor), "cursor colour")
        var palette = [GhosttyColorRgb](repeating: GhosttyColorRgb(), count: 256)
        Self.check(palette.withUnsafeMutableBytes {
            ghostty_terminal_get(terminal, GHOSTTY_TERMINAL_DATA_COLOR_PALETTE_DEFAULT, $0.baseAddress)
        }, "default palette")
        for (index, color) in colors.ansi.prefix(16).enumerated() { palette[index] = Self.rgb(color) }
        palette.withUnsafeBytes { set(GHOSTTY_TERMINAL_OPT_COLOR_PALETTE, $0.baseAddress, "palette") }
        forceFull = true
        guard schemeChanged, mode(2031) else { return [] }
        return Array("\u{1B}[?997;\(colors.isDark ? 1 : 2)n".utf8)
    }

    var isMouseTracking: Bool { read(GHOSTTY_TERMINAL_DATA_MOUSE_TRACKING, false, "mouse tracking") }

    var isAlternateScreen: Bool {
        let screen = read(GHOSTTY_TERMINAL_DATA_ACTIVE_SCREEN, GHOSTTY_TERMINAL_SCREEN_PRIMARY, "active screen")
        if screen != GHOSTTY_TERMINAL_SCREEN_PRIMARY, screen != GHOSTTY_TERMINAL_SCREEN_ALTERNATE {
            TerminalLog.unknown("active screen", Int64(screen.rawValue))
        }
        return screen == GHOSTTY_TERMINAL_SCREEN_ALTERNATE
    }

    var scrollback: TerminalFrame.Scrollback {
        let bar = read(GHOSTTY_TERMINAL_DATA_SCROLLBAR, GhosttyTerminalScrollbar(), "scrollbar")
        return TerminalFrame.Scrollback(total: Int(bar.total), offset: Int(bar.offset), visible: Int(bar.len))
    }

    func scrollViewport(by rows: Int) { scroll(GHOSTTY_TERMINAL_SCROLL_VIEWPORT_DELTA, delta: rows) }

    func scrollToBottom() -> Bool {
        let bar = scrollback
        guard bar.offset + bar.visible < bar.total else { return false }
        scroll(GHOSTTY_TERMINAL_SCROLL_VIEWPORT_BOTTOM, delta: 0)
        return true
    }

    private func scroll(_ tag: GhosttyTerminalScrollViewportTag, delta: Int) {
        var behavior = GhosttyTerminalScrollViewport()
        behavior.tag = tag
        behavior.value.delta = delta
        Self.check(ghostty_terminal_scroll_viewport(terminal, behavior), "scroll")
    }

    func selectionText() -> String? {
        var selection = GhosttySelection()
        guard ghostty_terminal_get(terminal, GHOSTTY_TERMINAL_DATA_SELECTION, &selection) == GHOSTTY_SUCCESS else { return nil }
        return format(selection)
    }

    func commandOutputText() -> String? {
        guard let outputStart, let outputEnd, ghostty_tracked_grid_ref_has_value(outputStart),
              ghostty_tracked_grid_ref_has_value(outputEnd) else { return nil }
        var selection = GhosttySelection()
        guard Self.check(ghostty_tracked_grid_ref_snapshot(outputStart, &selection.start), "output start"),
              Self.check(ghostty_tracked_grid_ref_snapshot(outputEnd, &selection.end), "output end") else { return nil }
        return format(selection)
    }

    private func semanticPrompt(_ kind: GhosttySemanticPromptKind) {
        switch kind {
        case GHOSTTY_SEMANTIC_PROMPT_OUTPUT_START:
            replace(&outputStart, with: track(atCursor: false))
            replace(&outputEnd, with: nil)
        case GHOSTTY_SEMANTIC_PROMPT_COMMAND_END:
            guard outputStart != nil else { return }
            replace(&outputEnd, with: track(atCursor: true))
            effects.commandEnded = outputEnd != nil
        case GHOSTTY_SEMANTIC_PROMPT_PROMPT_START, GHOSTTY_SEMANTIC_PROMPT_INPUT_START:
            break
        default:
            TerminalLog.unknown("semantic prompt step", Int64(kind.rawValue))
        }
    }

    private func track(atCursor before: Bool) -> GhosttyTrackedGridRef? {
        var column = Int(read(GHOSTTY_TERMINAL_DATA_CURSOR_X, UInt16(0), "cursor column"))
        var row = Int(read(GHOSTTY_TERMINAL_DATA_CURSOR_Y, UInt16(0), "cursor row"))
        if before {
            column -= 1
            if column < 0 {
                guard row > 0 else { return nil }
                row -= 1
                column = Int(grid.columns) - 1
            }
        }
        var point = GhosttyPoint()
        point.tag = GHOSTTY_POINT_TAG_ACTIVE
        point.value.coordinate = GhosttyPointCoordinate(x: UInt16(clamping: column), y: UInt32(clamping: row))
        var tracked: GhosttyTrackedGridRef?
        guard Self.check(ghostty_terminal_grid_ref_track(terminal, point, &tracked), "track output") else { return nil }
        return tracked
    }

    private func replace(_ slot: inout GhosttyTrackedGridRef?, with tracked: GhosttyTrackedGridRef?) {
        ghostty_tracked_grid_ref_free(slot)
        slot = tracked
    }

    private func format(_ selection: GhosttySelection) -> String? {
        var selection = selection
        var formatter: GhosttyFormatter?
        guard Self.check(ghostty_formatter_terminal_new(nil, &formatter, terminal), "formatter"), let formatter else { return nil }
        defer { ghostty_formatter_free(formatter) }
        var emit = GHOSTTY_FORMATTER_FORMAT_PLAIN
        var yes = true
        Self.check(ghostty_formatter_set(formatter, GHOSTTY_FORMATTER_OPT_EMIT, &emit), "formatter emit")
        Self.check(ghostty_formatter_set(formatter, GHOSTTY_FORMATTER_OPT_UNWRAP, &yes), "formatter unwrap")
        Self.check(ghostty_formatter_set(formatter, GHOSTTY_FORMATTER_OPT_TRIM, &yes), "formatter trim")
        Self.check(ghostty_formatter_set(formatter, GHOSTTY_FORMATTER_OPT_SELECTION, &selection), "formatter selection")
        var pointer: UnsafeMutablePointer<UInt8>?
        var length = 0
        guard Self.check(ghostty_formatter_format_alloc(formatter, nil, &pointer, &length), "format"), let pointer else { return nil }
        defer { ghostty_free(nil, pointer, length) }
        return String(decoding: UnsafeBufferPointer(start: pointer, count: length), as: UTF8.self)
    }

    func selectAll() {
        var selection = GhosttySelection()
        guard Self.check(ghostty_terminal_select_all(terminal, &selection), "select all") else { return }
        install(selection)
    }

    @discardableResult
    func clearSelection() -> Bool {
        var current = GhosttySelection()
        guard ghostty_terminal_get(terminal, GHOSTTY_TERMINAL_DATA_SELECTION, &current) == GHOSTTY_SUCCESS else { return false }
        install(nil)
        return true
    }

    func hyperlink(column: Int, row: Int) -> String? {
        guard var ref = reference(column: column, row: row) else { return nil }
        var length = 0
        guard ghostty_grid_ref_hyperlink_uri(&ref, nil, 0, &length) == GHOSTTY_OUT_OF_SPACE else { return nil }
        var bytes = [UInt8](repeating: 0, count: length)
        guard ghostty_grid_ref_hyperlink_uri(&ref, &bytes, length, &length) == GHOSTTY_SUCCESS else { return nil }
        return String(decoding: bytes.prefix(length), as: UTF8.self)
    }

    func clearScreen() -> Bool {
        guard !isAlternateScreen, read(GHOSTTY_TERMINAL_DATA_VT_GROUND, false, "parser ground") else { return false }
        let row: UInt16 = read(GHOSTTY_TERMINAL_DATA_CURSOR_Y, 0, "cursor row")
        let bytes = Array((row > 0 ? "\u{1B}[\(row)S\u{1B}[\(row)A\u{1B}[3J" : "\u{1B}[3J").utf8)
        ghostty_terminal_vt_write(terminal, bytes, bytes.count)
        install(nil)
        _ = scrollToBottom()
        forceFull = true
        return true
    }

    func select(_ input: PointerInput) {
        guard let ref = reference(column: input.column, row: input.row) else { return }
        let position = GhosttySurfacePosition(x: input.x, y: input.y)
        var selection = GhosttySelection()
        switch input.phase {
        case .press:
            setGesture(gesturePress, GHOSTTY_SELECTION_GESTURE_EVENT_OPT_REF, ref)
            setGesture(gesturePress, GHOSTTY_SELECTION_GESTURE_EVENT_OPT_POSITION, position)
            setGesture(gesturePress, GHOSTTY_SELECTION_GESTURE_EVENT_OPT_TIME_NS, input.time)
            setGesture(gesturePress, GHOSTTY_SELECTION_GESTURE_EVENT_OPT_REPEAT_INTERVAL_NS, input.repeatInterval)
            let result = ghostty_selection_gesture_event(gesture, terminal, gesturePress, &selection)
            install(result == GHOSTTY_SUCCESS ? selection : nil)
        case .drag:
            let geometry = GhosttySelectionGestureGeometry(columns: UInt32(grid.columns), cell_width: grid.cellWidth,
                                                           padding_left: 0, screen_height: UInt32(grid.rows) * grid.cellHeight)
            setGesture(gestureDrag, GHOSTTY_SELECTION_GESTURE_EVENT_OPT_REF, ref)
            setGesture(gestureDrag, GHOSTTY_SELECTION_GESTURE_EVENT_OPT_POSITION, position)
            setGesture(gestureDrag, GHOSTTY_SELECTION_GESTURE_EVENT_OPT_GEOMETRY, geometry)
            guard ghostty_selection_gesture_event(gesture, terminal, gestureDrag, &selection) == GHOSTTY_SUCCESS else { return }
            install(selection)
        case .release:
            setGesture(gestureRelease, GHOSTTY_SELECTION_GESTURE_EVENT_OPT_REF, ref)
            _ = ghostty_selection_gesture_event(gesture, terminal, gestureRelease, nil)
        case .motion:
            return
        }
    }

    private func setGesture<Value>(_ event: GhosttySelectionGestureEvent, _ option: GhosttySelectionGestureEventOption,
                                   _ value: Value) {
        var value = value
        let result = withUnsafeMutablePointer(to: &value) { ghostty_selection_gesture_event_set(event, option, $0) }
        Self.check(result, "selection gesture option \(option.rawValue)")
    }

    private func install(_ selection: GhosttySelection?) {
        if let selection {
            assign(GHOSTTY_TERMINAL_OPT_SELECTION, selection, "selection")
        } else {
            var current = GhosttySelection()
            guard ghostty_terminal_get(terminal, GHOSTTY_TERMINAL_DATA_SELECTION, &current) == GHOSTTY_SUCCESS else { return }
            set(GHOSTTY_TERMINAL_OPT_SELECTION, nil, "selection")
        }
        forceFull = true
    }

    private func reference(column: Int, row: Int) -> GhosttyGridRef? {
        var point = GhosttyPoint()
        point.tag = GHOSTTY_POINT_TAG_VIEWPORT
        point.value.coordinate = GhosttyPointCoordinate(x: UInt16(clamping: min(max(column, 0), Int(grid.columns) - 1)),
                                                        y: UInt32(clamping: min(max(row, 0), Int(grid.rows) - 1)))
        var ref = GhosttyGridRef()
        return ghostty_terminal_grid_ref(terminal, point, &ref) == GHOSTTY_SUCCESS ? ref : nil
    }

    func mode(_ number: UInt16) -> Bool {
        read(GHOSTTY_TERMINAL_DATA_MODE, GhosttyTerminalModeConfig(mode: ghostty_mode_new(number, false), value: false), "mode").value
    }

    func makeFrame(full requested: Bool) -> TerminalFrame {
        let interval = Self.signposter.beginInterval("frame")
        defer { Self.signposter.endInterval("frame", interval) }
        if let started = holdStarted, clock_gettime_nsec_np(CLOCK_UPTIME_RAW) - started > Self.holdLimit {
            assign(GHOSTTY_TERMINAL_OPT_MODE, GhosttyTerminalModeConfig(mode: ghostty_mode_new(2026, false), value: false), "sync")
            holdStarted = nil
        }
        if holdStarted == nil { Self.check(ghostty_render_state_update(renderState, terminal), "render state update") }
        let dirty = state(GHOSTTY_RENDER_STATE_DATA_DIRTY, GHOSTTY_RENDER_STATE_DIRTY_FALSE)
        var colors = GhosttyRenderStateColors()
        colors.size = MemoryLayout<GhosttyRenderStateColors>.size
        colors = state(GHOSTTY_RENDER_STATE_DATA_COLORS, colors)
        var cursor = GhosttyRenderStateCursor()
        cursor.size = MemoryLayout<GhosttyRenderStateCursor>.size
        cursor = state(GHOSTTY_RENDER_STATE_DATA_CURSOR, cursor)
        let columns: UInt16 = state(GHOSTTY_RENDER_STATE_DATA_COLS, 0)
        let rows: UInt16 = state(GHOSTTY_RENDER_STATE_DATA_ROWS, 0)
        let full = requested || forceFull || dirty == GHOSTTY_RENDER_STATE_DIRTY_FULL
        forceFull = false
        let foreground = Self.packed(colors.foreground)
        let background = Self.packed(colors.background)
        var changed: [FrameRow] = []
        let iterating = Self.check(ghostty_render_state_get(renderState, GHOSTTY_RENDER_STATE_DATA_ROW_ITERATOR, &rowIterator), "rows")
        var index = 0
        while iterating, ghostty_render_state_row_iterator_next(rowIterator) {
            defer { index += 1 }
            var rowDirty = false
            _ = ghostty_render_state_row_get(rowIterator, GHOSTTY_RENDER_STATE_ROW_DATA_DIRTY, &rowDirty)
            guard full || rowDirty else { continue }
            changed.append(makeRow(index, foreground: foreground, background: background))
        }
        Self.check(ghostty_render_state_clean(renderState), "render state clean")
        let shapes = [GHOSTTY_CURSOR_STYLE_BAR.rawValue: FrameCursor.Shape.bar, GHOSTTY_CURSOR_STYLE_UNDERLINE.rawValue: .underline,
                      GHOSTTY_CURSOR_STYLE_BLOCK_HOLLOW.rawValue: .hollow, GHOSTTY_CURSOR_STYLE_BLOCK.rawValue: .block]
        let shape = shapes[cursor.visual_style.rawValue] ?? .block
        if shapes[cursor.visual_style.rawValue] == nil { TerminalLog.unknown("cursor style", Int64(cursor.visual_style.rawValue)) }
        return TerminalFrame(
            columns: Int(columns), rows: Int(rows), full: full, background: background, foreground: foreground,
            cursorColor: colors.cursor_has_value ? Self.packed(colors.cursor) : foreground,
            cursor: FrameCursor(column: Int(cursor.viewport_x) - (cursor.wide_tail ? 1 : 0), row: Int(cursor.viewport_y),
                                visible: cursor.visible && cursor.viewport_has_value, blinking: cursor.blinking, shape: shape),
            changed: changed, mouseTracking: isMouseTracking, isAlternateScreen: isAlternateScreen, scrollback: scrollback
        )
    }

    private func makeRow(_ index: Int, foreground: UInt32, background: UInt32) -> FrameRow {
        var row = FrameRow(index: index)
        var selection = GhosttyRenderStateRowSelection()
        selection.size = MemoryLayout<GhosttyRenderStateRowSelection>.size
        if ghostty_render_state_row_get(rowIterator, GHOSTTY_RENDER_STATE_ROW_DATA_SELECTION, &selection) == GHOSTTY_SUCCESS {
            row.selection = Int(selection.start_x)...Int(selection.end_x)
        }
        guard Self.check(ghostty_render_state_row_get(rowIterator, GHOSTTY_RENDER_STATE_ROW_DATA_CELLS, &rowCells), "cells") else {
            return row
        }
        var codepoints = [UInt32](repeating: 0, count: 16)
        var column = -1
        while ghostty_render_state_row_cells_next(rowCells) {
            column += 1
            var raw: GhosttyCell = 0
            _ = ghostty_render_state_row_cells_get(rowCells, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_RAW, &raw)
            var wide = GHOSTTY_CELL_WIDE_NARROW
            _ = ghostty_cell_get(raw, GHOSTTY_CELL_DATA_WIDE, &wide)
            let width: UInt8
            switch wide {
            case GHOSTTY_CELL_WIDE_SPACER_TAIL, GHOSTTY_CELL_WIDE_SPACER_HEAD: continue
            case GHOSTTY_CELL_WIDE_WIDE: width = 2
            case GHOSTTY_CELL_WIDE_NARROW: width = 1
            default:
                TerminalLog.unknown("cell width", Int64(wide.rawValue))
                width = 1
            }
            var styled = false
            _ = ghostty_render_state_row_cells_get(rowCells, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_HAS_STYLING, &styled)
            var style = GhosttyStyle()
            var ink = foreground
            var fill: UInt32?
            if styled {
                _ = ghostty_render_state_row_cells_get(rowCells, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_STYLE, &style)
                var color = GhosttyColorRgb()
                if ghostty_render_state_row_cells_get(rowCells, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_FG_COLOR, &color) == GHOSTTY_SUCCESS {
                    ink = Self.packed(color)
                }
                if ghostty_render_state_row_cells_get(rowCells, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_BG_COLOR, &color) == GHOSTTY_SUCCESS {
                    fill = Self.packed(color)
                }
                if style.flags & (1 << 4) != 0 { (ink, fill) = (fill ?? background, ink) }
                if style.flags & (1 << 2) != 0 { ink = FrameRow.mix(ink, fill ?? background) }
            }
            if let fill { row.fill(column: column, width: width, color: fill) }
            let count = codepoints.withUnsafeMutableBufferPointer { buffer in
                var graphemes = GhosttyCodepointBuffer(ptr: buffer.baseAddress, cap: buffer.count, len: 0)
                let result = ghostty_render_state_row_cells_get(rowCells, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_GRAPHEMES_BUF, &graphemes)
                return result == GHOSTTY_SUCCESS || result == GHOSTTY_OUT_OF_SPACE ? min(graphemes.len, buffer.count) : 0
            }
            if count == 0 || style.flags & (1 << 5) != 0 { continue }
            if count == 1, (0x2500...0x259F).contains(codepoints[0]) {
                row.sprites.append(FrameSprite(column: UInt16(column), scalar: codepoints[0], color: ink))
                continue
            }
            row.append(codepoints.prefix(count), column: column, width: width, color: ink, style: Self.runStyle(style.flags))
        }
        return row
    }

    private func installCallbacks() {
        set(GHOSTTY_TERMINAL_OPT_USERDATA, UnsafeRawPointer(Unmanaged.passUnretained(self).toOpaque()), "userdata")
        let writePty: GhosttyTerminalWritePtyFn = { _, userdata, data, length in
            guard let data else { return }
            TerminalEngine.owner(userdata)?.effects.reply.append(contentsOf: UnsafeBufferPointer(start: data, count: length))
        }
        let bell: GhosttyTerminalBellFn = { _, userdata in TerminalEngine.owner(userdata)?.effects.bells += 1 }
        let titleChanged: GhosttyTerminalTitleChangedFn = { _, userdata in TerminalEngine.owner(userdata)?.readTitle() }
        let renderHold: GhosttyTerminalRenderHoldFn = { _, userdata, held in TerminalEngine.owner(userdata)?.renderHold(held) }
        let colorScheme: GhosttyTerminalColorSchemeFn = { _, userdata, scheme in
            guard let engine = TerminalEngine.owner(userdata) else { return false }
            scheme?.pointee = engine.isDark ? GHOSTTY_COLOR_SCHEME_DARK : GHOSTTY_COLOR_SCHEME_LIGHT
            return true
        }
        let size: GhosttyTerminalSizeFn = { _, userdata, size in
            guard let grid = TerminalEngine.owner(userdata)?.grid else { return false }
            size?.pointee = GhosttySizeReportSize(rows: grid.rows, columns: grid.columns, cell_width: grid.cellWidth,
                                                  cell_height: grid.cellHeight)
            return true
        }
        let semantic: GhosttyTerminalSemanticPromptFn = { _, userdata, event in
            guard let kind = event?.pointee.kind else { return }
            TerminalEngine.owner(userdata)?.semanticPrompt(kind)
        }
        let xtversion: GhosttyTerminalXtversionFn = { _, _ in
            GhosttyString(ptr: TerminalEngine.version.utf8Start, len: TerminalEngine.version.utf8CodeUnitCount)
        }
        func pointer<Callback>(_ callback: Callback) -> UnsafeRawPointer { unsafeBitCast(callback, to: UnsafeRawPointer.self) }
        for (option, callback) in [(GHOSTTY_TERMINAL_OPT_WRITE_PTY, pointer(writePty)), (GHOSTTY_TERMINAL_OPT_BELL, pointer(bell)),
                                   (GHOSTTY_TERMINAL_OPT_TITLE_CHANGED, pointer(titleChanged)),
                                   (GHOSTTY_TERMINAL_OPT_PWD_CHANGED, pointer(titleChanged)),
                                   (GHOSTTY_TERMINAL_OPT_RENDER_HOLD, pointer(renderHold)),
                                   (GHOSTTY_TERMINAL_OPT_COLOR_SCHEME, pointer(colorScheme)), (GHOSTTY_TERMINAL_OPT_SIZE, pointer(size)),
                                   (GHOSTTY_TERMINAL_OPT_XTVERSION, pointer(xtversion)),
                                   (GHOSTTY_TERMINAL_OPT_SEMANTIC_PROMPT, pointer(semantic))] {
            set(option, callback, "callback")
        }
    }

    private static func owner(_ userdata: UnsafeMutableRawPointer?) -> TerminalEngine? {
        userdata.map { Unmanaged<TerminalEngine>.fromOpaque($0).takeUnretainedValue() }
    }

    private func readTitle() {
        title = text(GHOSTTY_TERMINAL_DATA_TITLE)
        directory = text(GHOSTTY_TERMINAL_DATA_PWD)
        effects.titleChanged = true
    }

    private func text(_ data: GhosttyTerminalData) -> String? {
        var value = GhosttyString()
        guard ghostty_terminal_get(terminal, data, &value) == GHOSTTY_SUCCESS, let pointer = value.ptr, value.len > 0 else { return nil }
        return String(decoding: UnsafeBufferPointer(start: pointer, count: value.len), as: UTF8.self)
    }

    private func renderHold(_ held: Bool) {
        guard held else { return holdStarted = nil }
        Self.check(ghostty_render_state_update(renderState, terminal), "render state update")
        holdStarted = clock_gettime_nsec_np(CLOCK_UPTIME_RAW)
        effects.holdStarted = true
    }

    func read<Value>(_ data: GhosttyTerminalData, _ initial: Value, _ operation: StaticString) -> Value {
        var value = initial
        Self.check(withUnsafeMutablePointer(to: &value) { ghostty_terminal_get(terminal, data, $0) }, "\(operation)")
        return value
    }

    private func state<Value>(_ data: GhosttyRenderStateData, _ initial: Value) -> Value {
        var value = initial
        Self.check(withUnsafeMutablePointer(to: &value) { ghostty_render_state_get(renderState, data, $0) }, "render \(data.rawValue)")
        return value
    }

    private func set(_ option: GhosttyTerminalOption, _ value: UnsafeRawPointer?, _ operation: StaticString) {
        Self.check(ghostty_terminal_set(terminal, option, value), "\(operation)")
    }

    private func assign<Value>(_ option: GhosttyTerminalOption, _ value: Value, _ operation: StaticString) {
        var value = value
        Self.check(withUnsafePointer(to: &value) { ghostty_terminal_set(terminal, option, $0) }, "\(operation)")
    }

    func encode(_ operation: StaticString,
                        _ body: (UnsafeMutablePointer<UInt8>?, Int, UnsafeMutablePointer<Int>) -> GhosttyResult) -> [UInt8] {
        var buffer = [UInt8](repeating: 0, count: 128)
        var written = 0
        var result = body(&buffer, buffer.count, &written)
        if result == GHOSTTY_OUT_OF_SPACE {
            buffer = [UInt8](repeating: 0, count: written)
            result = body(&buffer, buffer.count, &written)
        }
        return Self.check(result, "encode \(operation)") ? Array(buffer.prefix(written)) : []
    }

    @discardableResult
    static func check(_ result: GhosttyResult, _ operation: @autoclosure () -> String) -> Bool {
        guard result != GHOSTTY_SUCCESS else { return true }
        let name = operation()
        TerminalLog.logger.error("libghostty \(name, privacy: .public) failed: \(describe(result), privacy: .public)")
        return false
    }

    private static func describe(_ result: GhosttyResult) -> String {
        switch result {
        case GHOSTTY_OUT_OF_MEMORY: "out of memory"
        case GHOSTTY_INVALID_VALUE: "invalid value"
        case GHOSTTY_OUT_OF_SPACE: "out of space"
        case GHOSTTY_NO_VALUE: "no value"
        case GHOSTTY_IO_ERROR: "input or output error"
        case GHOSTTY_LIMIT_EXCEEDED: "limit exceeded"
        case GHOSTTY_REJECTED: "rejected"
        case GHOSTTY_UNSUPPORTED: "unsupported"
        default: "unknown result \(result.rawValue)"
        }
    }

    private static func runStyle(_ flags: GhosttyStyleFlags) -> UInt16 {
        let bits: [(GhosttyStyleFlags, UInt16)] = [(1 << 0, RunStyle.bold), (1 << 1, RunStyle.italic), (1 << 6, RunStyle.strikethrough),
                                                   (1 << 7, RunStyle.overline)]
        let style = bits.reduce(0) { flags & $1.0 != 0 ? $0 | $1.1 : $0 }
        switch (flags >> 8) & 0x7 {
        case 0: return style
        case 2: return style | RunStyle.doubleUnderline
        default: return style | RunStyle.underline
        }
    }

    private static func rgb(_ packed: UInt32) -> GhosttyColorRgb {
        GhosttyColorRgb(r: UInt8(packed >> 16 & 0xFF), g: UInt8(packed >> 8 & 0xFF), b: UInt8(packed & 0xFF))
    }

    private static func packed(_ color: GhosttyColorRgb) -> UInt32 { UInt32(color.r) << 16 | UInt32(color.g) << 8 | UInt32(color.b) }
}
