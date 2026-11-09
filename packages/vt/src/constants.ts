export const Result = {
  SUCCESS: 0,
  INVALID_VALUE: -2,
  OUT_OF_SPACE: -3,
  NO_VALUE: -4,
  REJECTED: -7,
} as const;

export const TerminalOption = {
  WRITE_PTY: 2,
  TITLE_CHANGED: 6,
  SIZE: 7,
  COLOR_SCHEME: 8,
  COLOR_FOREGROUND: 12,
  COLOR_BACKGROUND: 13,
  COLOR_CURSOR: 14,
  COLOR_PALETTE: 15,
  SELECTION: 22,
  DEFAULT_CURSOR_STYLE: 23,
  DEFAULT_CURSOR_BLINK: 24,
  SCROLLBACK_MAX_BYTES: 28,
  SCROLLBACK_MAX_LINES: 29,
  MODE_DEFAULT: 34,
  MODE: 35,
  RENDER_HOLD: 42,
} as const;

export const TerminalData = {
  COLS: 1,
  ROWS: 2,
  CURSOR_Y: 4,
  ACTIVE_SCREEN: 6,
  SCROLLBAR: 9,
  MOUSE_TRACKING: 11,
  TITLE: 12,
  SELECTION: 31,
  MODE: 37,
} as const;

export const TerminalScreen = { ALTERNATE: 1 } as const;

export const CursorStyle = { BAR: 0, BLOCK: 1, UNDERLINE: 2, BLOCK_HOLLOW: 3 } as const;

export const ScrollViewportTag = { BOTTOM: 1, DELTA: 2 } as const;

export const RenderStateData = {
  COLS: 1,
  ROWS: 2,
  DIRTY: 3,
  ROW_ITERATOR: 4,
  CURSOR: 18,
  COLORS: 19,
} as const;

export const RenderStateDirty = { FULL: 2 } as const;

export const RowData = { RAW: 2, CELLS: 3, SELECTION: 4, CELLS_RAW: 5 } as const;

export const ScreenRowData = { WRAP: 1 } as const;

export const RowCellsData = { STYLE: 2, GRAPHEMES_UTF8: 9 } as const;

export const CellContentTag = {
  CODEPOINT_GRAPHEME: 1,
  BG_COLOR_PALETTE: 2,
  BG_COLOR_RGB: 3,
} as const;

export const CellWide = { WIDE: 1, SPACER_TAIL: 2 } as const;

export const StyleColorTag = { PALETTE: 1, RGB: 2 } as const;

export const SgrUnderline = {
  NONE: 0,
  SINGLE: 1,
  DOUBLE: 2,
  CURLY: 3,
  DOTTED: 4,
  DASHED: 5,
} as const;

export const ColorScheme = { LIGHT: 0, DARK: 1 } as const;

export const FocusEvent = { GAINED: 0, LOST: 1 } as const;

export const KeyAction = { RELEASE: 0, PRESS: 1, REPEAT: 2 } as const;

export const MouseAction = { PRESS: 0, RELEASE: 1, MOTION: 2 } as const;

export const MouseButton = {
  LEFT: 1,
  RIGHT: 2,
  MIDDLE: 3,
  FOUR: 4,
  FIVE: 5,
  SIX: 6,
  SEVEN: 7,
} as const;

export const MouseEncoderOption = { SIZE: 3, ANY_BUTTON_PRESSED: 4, TRACK_LAST_CELL: 5 } as const;

export const PointTag = { ACTIVE: 0, VIEWPORT: 1, SCREEN: 2 } as const;

export const FormatterOption = { UNWRAP: 2, SELECTION: 4 } as const;

export const ClipboardLocation = { STANDARD: 0 } as const;

export const PasteSource = { CLIPBOARD: 0 } as const;

export const SysOption = { RANDOM_SECURE: 4 } as const;

export const GestureEventType = { PRESS: 0, RELEASE: 1, DRAG: 2 } as const;

export const GestureEventOption = {
  REF: 1,
  POSITION: 2,
  REPEAT_DISTANCE: 3,
  TIME_NS: 4,
  REPEAT_INTERVAL_NS: 5,
  RECTANGLE: 8,
  GEOMETRY: 9,
} as const;

export const manifestEnums = {
  GhosttyResult: Result,
  GhosttyTerminalOption: TerminalOption,
  GhosttyTerminalData: TerminalData,
  GhosttyTerminalScreen: TerminalScreen,
  GhosttyCursorStyle: CursorStyle,
  GhosttyTerminalScrollViewportTag: ScrollViewportTag,
  GhosttyRenderStateData: RenderStateData,
  GhosttyRenderStateDirty: RenderStateDirty,
  GhosttyRenderStateRowData: RowData,
  GhosttyRowData: ScreenRowData,
  GhosttyRenderStateRowCellsData: RowCellsData,
  GhosttyCellContentTag: CellContentTag,
  GhosttyCellWide: CellWide,
  GhosttyStyleColorTag: StyleColorTag,
  GhosttySgrUnderline: SgrUnderline,
  GhosttyColorScheme: ColorScheme,
  GhosttyFocusEvent: FocusEvent,
  GhosttyKeyAction: KeyAction,
  GhosttyMouseAction: MouseAction,
  GhosttyMouseButton: MouseButton,
  GhosttyMouseEncoderOption: MouseEncoderOption,
  GhosttyPointTag: PointTag,
  GhosttyFormatterOption: FormatterOption,
  GhosttyClipboardLocation: ClipboardLocation,
  GhosttyPasteSource: PasteSource,
  GhosttySysOption: SysOption,
  GhosttySelectionGestureEventType: GestureEventType,
  GhosttySelectionGestureEventOption: GestureEventOption,
} as const;

export const Mode = {
  LINEFEED: 20 | 0x8000,
  FOCUS_EVENT: 1004,
  ALT_SCROLL: 1007,
  SYNC_OUTPUT: 2026,
  GRAPHEME_CLUSTER: 2027,
  COLOR_SCHEME_REPORT: 2031,
} as const;

export const Mods = {
  SHIFT: 1 << 0,
  CTRL: 1 << 1,
  ALT: 1 << 2,
  SUPER: 1 << 3,
} as const;
