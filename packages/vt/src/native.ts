const functions = [
  "ghostty_type_json",
  "ghostty_wasm_alloc",
  "ghostty_wasm_alloc_opaque",
  "ghostty_wasm_take_opaque",
  "ghostty_sys_set",
  "ghostty_terminal_new",
  "ghostty_terminal_resize",
  "ghostty_terminal_set",
  "ghostty_terminal_get",
  "ghostty_terminal_grid_ref",
  "ghostty_terminal_grid_ref_track",
  "ghostty_terminal_point_from_grid_ref",
  "ghostty_terminal_paste",
  "ghostty_terminal_select_all",
  "ghostty_terminal_selection_format_buf",
  "ghostty_grid_ref_cell",
  "ghostty_grid_ref_hyperlink_uri",
  "ghostty_tracked_grid_ref_point",
  "ghostty_render_state_new",
  "ghostty_render_state_update",
  "ghostty_render_state_get",
  "ghostty_render_state_clean",
  "ghostty_render_state_row_iterator_new",
  "ghostty_render_state_row_iterator_next",
  "ghostty_render_state_row_iterator_next_dirty",
  "ghostty_render_state_row_get",
  "ghostty_render_state_row_cells_new",
  "ghostty_render_state_row_cells_select",
  "ghostty_render_state_row_cells_get",
  "ghostty_key_encoder_new",
  "ghostty_key_encoder_encode",
  "ghostty_key_event_new",
  "ghostty_mouse_encoder_new",
  "ghostty_mouse_encoder_encode",
  "ghostty_mouse_event_new",
  "ghostty_focus_encode",
  "ghostty_color_scheme_report_encode",
  "ghostty_selection_gesture_new",
  "ghostty_selection_gesture_event_new",
  "ghostty_selection_gesture_event_set",
  "ghostty_selection_gesture_event",
] as const;

/** Take a 64-bit `GhosttyRow` by value, which JavaScript passes as a bigint. */
const rowReaders = ["ghostty_row_get"] as const;

const procedures = [
  "ghostty_wasm_free",
  "ghostty_terminal_free",
  "ghostty_terminal_reset",
  "ghostty_terminal_vt_write",
  "ghostty_terminal_scroll_viewport",
  "ghostty_tracked_grid_ref_free",
  "ghostty_color_palette_default",
  "ghostty_render_state_free",
  "ghostty_render_state_row_iterator_free",
  "ghostty_render_state_row_cells_free",
  "ghostty_key_encoder_free",
  "ghostty_key_encoder_setopt",
  "ghostty_key_encoder_setopt_from_terminal",
  "ghostty_key_event_free",
  "ghostty_key_event_set_action",
  "ghostty_key_event_set_key",
  "ghostty_key_event_set_mods",
  "ghostty_key_event_set_consumed_mods",
  "ghostty_key_event_set_composing",
  "ghostty_key_event_set_utf8",
  "ghostty_key_event_set_unshifted_codepoint",
  "ghostty_mouse_encoder_free",
  "ghostty_mouse_encoder_setopt",
  "ghostty_mouse_encoder_setopt_from_terminal",
  "ghostty_mouse_event_free",
  "ghostty_mouse_event_set_action",
  "ghostty_mouse_event_set_button",
  "ghostty_mouse_event_clear_button",
  "ghostty_mouse_event_set_mods",
  "ghostty_mouse_event_set_position",
  "ghostty_selection_gesture_free",
  "ghostty_selection_gesture_event_free",
] as const;

export type Native = {
  readonly [Name in (typeof functions)[number]]: (...args: number[]) => number;
} & {
  readonly [Name in (typeof rowReaders)[number]]: (
    row: bigint,
    data: number,
    out: number,
  ) => number;
} & {
  readonly [Name in (typeof procedures)[number]]: (...args: number[]) => void;
} & {
  readonly memory: WebAssembly.Memory;
  readonly __indirect_function_table: WebAssembly.Table;
};

export function checkExports(module: WebAssembly.Module) {
  const exported = new Map(
    WebAssembly.Module.exports(module).map((entry) => [entry.name, entry.kind]),
  );

  const required = [
    ...[...functions, ...rowReaders, ...procedures].map((name) => [name, "function"] as const),
    ["memory", "memory"] as const,
    ["__indirect_function_table", "table"] as const,
  ];

  const missing = required.find((entry) => exported.get(entry[0]) !== entry[1]);

  if (missing !== undefined)
    throw new Error(`libghostty-vt is missing the ${missing[1]} export ${missing[0]}`);
}

export function requireNative(
  exports: WebAssembly.Exports,
): asserts exports is WebAssembly.Exports & Native {
  const complete =
    [...functions, ...rowReaders, ...procedures].every(
      (name) => exports[name] instanceof Function,
    ) &&
    exports.memory instanceof WebAssembly.Memory &&
    exports.__indirect_function_table instanceof WebAssembly.Table;

  if (!complete) throw new Error("libghostty-vt exports do not match the checked module");
}
