export const Result = {
  SUCCESS: 0,
  INVALID_VALUE: -2,
  OUT_OF_SPACE: -3,
  NO_VALUE: -4,
  REJECTED: -7,
} as const;

export const TerminalOption = {
  WRITE_PTY: 1,
  TITLE_CHANGED: 5,
  SIZE: 6,
  COLOR_SCHEME: 7,
  DEVICE_ATTRIBUTES: 8,
  COLOR_FOREGROUND: 11,
  COLOR_BACKGROUND: 12,
  COLOR_CURSOR: 13,
  COLOR_PALETTE: 14,
  SELECTION: 21,
  DEFAULT_CURSOR_STYLE: 22,
  DEFAULT_CURSOR_BLINK: 23,
  SCROLLBACK_MAX_BYTES: 27,
  SCROLLBACK_MAX_LINES: 28,
  MODE_DEFAULT: 33,
  MODE: 34,
  RENDER_HOLD: 41,
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
  VT_GROUND: 38,
} as const;

export const TerminalScreen = { ALTERNATE: 1 } as const;

export const TerminalCursorStyle = { BAR: 0, BLOCK: 1, UNDERLINE: 2, BLOCK_HOLLOW: 3 } as const;

export const ScrollViewportTag = { BOTTOM: 1, DELTA: 2 } as const;

export const RenderStateData = { DIRTY: 3, ROW_ITERATOR: 4, CURSOR: 18, COLORS: 19 } as const;

export const RenderStateDirty = { FULL: 2 } as const;

export const CursorVisualStyle = { BAR: 0, BLOCK: 1, UNDERLINE: 2, BLOCK_HOLLOW: 3 } as const;

export const RowData = { CELLS: 3, SELECTION: 4, CELLS_RAW: 5 } as const;

export const RowCellsData = { STYLE: 2, GRAPHEMES_LEN: 3, GRAPHEMES_BUF: 4 } as const;

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

export const KeyEncoderOption = { MACOS_OPTION_AS_ALT: 6 } as const;

export const OptionAsAlt = { FALSE: 0, TRUE: 1 } as const;

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

export const MouseEncoderOption = { SIZE: 2, ANY_BUTTON_PRESSED: 3, TRACK_LAST_CELL: 4 } as const;

export const PointTag = { ACTIVE: 0, VIEWPORT: 1, SCREEN: 2 } as const;

export const FormatterFormat = { PLAIN: 0 } as const;

export const ClipboardLocation = { STANDARD: 0 } as const;

export const PasteSource = { CLIPBOARD: 0 } as const;

export const SysOption = { RANDOM_SECURE: 3 } as const;

export const GestureEventType = { PRESS: 0, RELEASE: 1, DRAG: 2 } as const;

export const GestureEventOption = {
  REF: 0,
  POSITION: 1,
  REPEAT_DISTANCE: 2,
  TIME_NS: 3,
  REPEAT_INTERVAL_NS: 4,
  RECTANGLE: 7,
  GEOMETRY: 8,
} as const;

export const manifestEnums = {
  GhosttyResult: Result,
  GhosttyTerminalOption: TerminalOption,
  GhosttyTerminalData: TerminalData,
  GhosttyTerminalScreen: TerminalScreen,
  GhosttyTerminalCursorStyle: TerminalCursorStyle,
  GhosttyTerminalScrollViewportTag: ScrollViewportTag,
  GhosttyRenderStateData: RenderStateData,
  GhosttyRenderStateDirty: RenderStateDirty,
  GhosttyRenderStateCursorVisualStyle: CursorVisualStyle,
  GhosttyRenderStateRowData: RowData,
  GhosttyRenderStateRowCellsData: RowCellsData,
  GhosttyCellContentTag: CellContentTag,
  GhosttyCellWide: CellWide,
  GhosttyStyleColorTag: StyleColorTag,
  GhosttySgrUnderline: SgrUnderline,
  GhosttyColorScheme: ColorScheme,
  GhosttyFocusEvent: FocusEvent,
  GhosttyKeyAction: KeyAction,
  GhosttyKeyEncoderOption: KeyEncoderOption,
  GhosttyOptionAsAlt: OptionAsAlt,
  GhosttyMouseAction: MouseAction,
  GhosttyMouseButton: MouseButton,
  GhosttyMouseEncoderOption: MouseEncoderOption,
  GhosttyPointTag: PointTag,
  GhosttyFormatterFormat: FormatterFormat,
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
  SHIFT_SIDE: 1 << 6,
  CTRL_SIDE: 1 << 7,
  ALT_SIDE: 1 << 8,
  SUPER_SIDE: 1 << 9,
} as const;

export const DeviceAttributes = {
  CONFORMANCE_LEVEL_2: 62,
  FEATURE_ANSI_COLOR: 22,
  DEVICE_TYPE_VT220: 1,
  FIRMWARE_VERSION: 10,
} as const;
