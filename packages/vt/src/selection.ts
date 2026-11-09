import { pixelPosition } from "./context.ts";
import {
  FormatterOption,
  GestureEventOption,
  GestureEventType,
  PointTag,
  Result,
  TerminalData,
  TerminalOption,
  TerminalScreen,
} from "./constants.ts";
import { check } from "./memory.ts";

import type { Context, Geometry } from "./context.ts";
import type { Mark, SelectionInput } from "./index.ts";

interface Selection {
  readonly select: (input: SelectionInput) => void;
  readonly clear: () => void;
  readonly active: () => boolean;
  readonly text: () => string;
  readonly top: () => number | null;
  readonly markCursorLine: () => Mark | null;
  readonly dispose: () => void;
}

const repeatIntervalNs = 500_000_000n;

export function createSelection(context: Context): Selection {
  const native = context.native;
  const layout = context.layout;
  const memory = context.memory;
  const terminal = context.terminal;

  const gesture = memory.handle(
    (slot) => native.ghostty_selection_gesture_new(0, slot),
    "selection gesture",
  );

  const event = (type: number) =>
    memory.handle(
      (slot) => native.ghostty_selection_gesture_event_new(0, slot, type),
      "selection gesture event",
    );

  const formatter = memory.handle(
    (slot) => native.ghostty_formatter_terminal_new(0, slot, terminal),
    "formatter",
  );

  const events = {
    press: event(GestureEventType.PRESS),
    drag: event(GestureEventType.DRAG),
    release: event(GestureEventType.RELEASE),
  };

  const selection = memory.allocate(layout.selection.size);
  const point = memory.allocate(layout.point.size);
  const ref = memory.allocate(layout.gridRef.size);
  const position = memory.allocate(layout.surfacePosition.size);
  const geometry = memory.allocate(layout.geometry.size);
  const value = memory.allocate(8);
  const coordinate = memory.allocate(layout.coordinate.size);
  const written = memory.allocate(8);
  const output = memory.growable(256);
  const marks = new Set<() => void>();

  const setOption = (target: number, option: number, pointer: number) =>
    check(
      native.ghostty_selection_gesture_event_set(target, option, pointer),
      "selection gesture option",
    );

  const writePoint = (tag: number, x: number, y: number) => {
    const view = memory.view();

    view.setInt32(point + layout.point.tag, tag, true);
    view.setUint16(point + layout.point.x, x, true);
    view.setUint32(point + layout.point.y, y, true);
  };

  const resolve = (tag: number, x: number, y: number, target: number) => {
    writePoint(tag, x, y);

    return native.ghostty_terminal_grid_ref(terminal, point, target);
  };

  const readSelection = () => {
    const result = native.ghostty_terminal_get(terminal, TerminalData.SELECTION, selection);

    if (result !== Result.NO_VALUE) check(result, "selection query");

    return result === Result.SUCCESS;
  };

  const install = (pointer: number) =>
    check(
      native.ghostty_terminal_set(terminal, TerminalOption.SELECTION, pointer),
      "selection install",
    );

  const setFormat = (option: number, pointer: number) =>
    check(native.ghostty_formatter_set(formatter, option, pointer), "formatter option");

  const format = (unwrap: boolean) => {
    memory.view().setUint8(value, unwrap ? 1 : 0);
    setFormat(FormatterOption.UNWRAP, value);
    setFormat(FormatterOption.SELECTION, selection);

    const run = () =>
      native.ghostty_formatter_format_buf(formatter, output.pointer(), output.capacity(), written);

    const first = run();

    if (first === Result.OUT_OF_SPACE) output.reserve(memory.view().getUint32(written, true));
    check(first === Result.OUT_OF_SPACE ? run() : first, "selection format");

    return memory.text(output.pointer(), memory.view().getUint32(written, true));
  };

  const screenRow = (target: number) => {
    check(
      native.ghostty_terminal_point_from_grid_ref(terminal, target, PointTag.SCREEN, coordinate),
      "point",
    );

    return memory.view().getUint32(coordinate + layout.coordinate.y, true);
  };

  const queryNumber = (data: number) => {
    memory.view().setUint32(value, 0, true);
    check(native.ghostty_terminal_get(terminal, data, value), "terminal query");

    return memory.view();
  };

  const configurePress = (time: number, size: Geometry) => {
    setOption(events.press, GestureEventOption.POSITION, position);
    memory.view().setBigUint64(value, BigInt(Math.max(0, Math.round(time * 1_000_000))), true);
    setOption(events.press, GestureEventOption.TIME_NS, value);
    memory.view().setFloat64(value, size.pixels.width, true);
    setOption(events.press, GestureEventOption.REPEAT_DISTANCE, value);
  };

  const configureDrag = (rectangle: boolean, size: Geometry) => {
    const view = memory.view();
    const area = layout.geometry;

    view.setUint32(geometry + area.columns, size.cols, true);
    view.setUint32(geometry + area.cellWidth, size.pixels.width, true);
    view.setUint32(geometry + area.paddingLeft, 0, true);
    view.setUint32(geometry + area.screenHeight, size.rows * size.pixels.height, true);
    view.setUint8(value, rectangle ? 1 : 0);
    setOption(events.drag, GestureEventOption.POSITION, position);
    setOption(events.drag, GestureEventOption.GEOMETRY, geometry);
    setOption(events.drag, GestureEventOption.RECTANGLE, value);
  };

  memory.view().setBigUint64(value, repeatIntervalNs, true);
  setOption(events.press, GestureEventOption.REPEAT_INTERVAL_NS, value);

  return {
    select: (input) => {
      const size = context.geometry();
      const pixels = pixelPosition(size, input.x, input.y);
      const target = events[input.action];
      const col = Math.min(Math.max(input.col, 0), size.cols - 1);
      const row = Math.min(Math.max(input.row, 0), size.rows - 1);

      memory.view().setFloat64(position + layout.surfacePosition.x, pixels.x, true);
      memory.view().setFloat64(position + layout.surfacePosition.y, pixels.y, true);
      check(resolve(PointTag.VIEWPORT, col, row, ref), "selection cell");
      setOption(target, GestureEventOption.REF, ref);

      if (input.action === "press") configurePress(input.time, size);

      if (input.action === "drag") configureDrag(input.rectangle, size);

      const result = native.ghostty_selection_gesture_event(gesture, terminal, target, selection);

      if (result === Result.SUCCESS) install(selection);

      if (result === Result.NO_VALUE && input.action === "press") install(0);

      if (result !== Result.NO_VALUE) check(result, "selection gesture");
    },
    clear: () => install(0),
    active: readSelection,
    text: () => (readSelection() ? format(true) : ""),
    top: () => {
      if (!readSelection()) return null;

      return Math.min(
        screenRow(selection + layout.selection.start),
        screenRow(selection + layout.selection.end),
      );
    },
    markCursorLine: () => {
      if (
        queryNumber(TerminalData.ACTIVE_SCREEN).getInt32(value, true) === TerminalScreen.ALTERNATE
      )
        return null;
      const y = queryNumber(TerminalData.CURSOR_Y).getUint16(value, true);
      const cols = context.geometry().cols;

      check(resolve(PointTag.ACTIVE, 0, y, selection + layout.selection.start), "mark start");
      check(resolve(PointTag.ACTIVE, cols - 1, y, selection + layout.selection.end), "mark end");
      memory.view().setUint8(selection + layout.selection.rectangle, 0);
      const text = format(false).trim();

      if (text === "") return null;
      writePoint(PointTag.ACTIVE, 0, y);

      const tracked = memory.handle(
        (slot) => native.ghostty_terminal_grid_ref_track(terminal, point, slot),
        "mark track",
      );

      let live = true;

      const release = () => {
        if (!live) return;
        live = false;
        marks.delete(release);
        native.ghostty_tracked_grid_ref_free(tracked);
      };

      marks.add(release);

      return {
        text,
        row: () => {
          if (!live) return null;

          const result = native.ghostty_tracked_grid_ref_point(
            tracked,
            PointTag.SCREEN,
            coordinate,
          );

          if (result === Result.NO_VALUE) return null;
          check(result, "mark row");

          return memory.view().getUint32(coordinate + layout.coordinate.y, true);
        },
        dispose: release,
      };
    },
    dispose: () => {
      [...marks].forEach((release) => release());
      Object.values(events).forEach((target) =>
        native.ghostty_selection_gesture_event_free(target),
      );
      native.ghostty_selection_gesture_free(gesture, terminal);
      native.ghostty_formatter_free(formatter);
    },
  };
}
