import { manifestEnums } from "./constants.ts";

import type { Manifest } from "./manifest.ts";

export type Layout = ReturnType<typeof readLayout>;

export function readLayout(manifest: Manifest) {
  checkEnums(manifest);

  const struct = manifest.struct;
  const scrollbar = struct("GhosttyTerminalScrollbar");
  const scrollViewport = struct("GhosttyTerminalScrollViewport");
  const modeConfig = struct("GhosttyTerminalModeConfig");
  const attributes = struct("GhosttyDeviceAttributes");
  const primary = struct("GhosttyDeviceAttributesPrimary");
  const secondary = struct("GhosttyDeviceAttributesSecondary");
  const tertiary = struct("GhosttyDeviceAttributesTertiary");
  const sizeReport = struct("GhosttySizeReportSize");
  const rgb = struct("GhosttyColorRgb");
  const cursor = struct("GhosttyRenderStateCursor");
  const colors = struct("GhosttyRenderStateColors");
  const rowSelection = struct("GhosttyRenderStateRowSelection");
  const cellsView = struct("GhosttyCellsView");
  const style = struct("GhosttyStyle");
  const styleColor = struct("GhosttyStyleColor");
  const styleColorValue = struct("GhosttyStyleColorValue");
  const mouseSize = struct("GhosttyMouseEncoderSize");
  const mousePosition = struct("GhosttyMousePosition");
  const point = struct("GhosttyPoint");
  const pointValue = struct("GhosttyPointValue");
  const coordinate = struct("GhosttyPointCoordinate");
  const gridRef = struct("GhosttyGridRef");
  const selection = struct("GhosttySelection");
  const surfacePosition = struct("GhosttySurfacePosition");
  const geometry = struct("GhosttySelectionGestureGeometry");
  const formatOptions = struct("GhosttyTerminalSelectionFormatOptions");
  const paste = struct("GhosttyPaste");
  const mimeReader = struct("GhosttyMimeReader");
  const writer = struct("GhosttyWriter");
  const string = struct("GhosttyString");
  const valueOffset = scrollViewport.field("value");
  const coordinateOffset = point.field("value") + pointValue.field("coordinate", 8);

  return {
    scrollbar: {
      size: scrollbar.size,
      total: scrollbar.field("total", 8),
      offset: scrollbar.field("offset", 8),
      length: scrollbar.field("len", 8),
    },
    scrollViewport: {
      size: scrollViewport.size,
      tag: scrollViewport.field("tag", 4),
      delta: valueOffset + struct("GhosttyTerminalScrollViewportValue").field("delta", 4),
    },
    modeConfig: {
      size: modeConfig.size,
      mode: modeConfig.field("mode", 2),
      value: modeConfig.field("value", 1),
    },
    attributes: {
      conformanceLevel: attributes.field("primary") + primary.field("conformance_level", 2),
      features: attributes.field("primary") + primary.field("features"),
      featureCount: attributes.field("primary") + primary.field("num_features", 4),
      deviceType: attributes.field("secondary") + secondary.field("device_type", 2),
      firmwareVersion: attributes.field("secondary") + secondary.field("firmware_version", 2),
      romCartridge: attributes.field("secondary") + secondary.field("rom_cartridge", 2),
      unitId: attributes.field("tertiary") + tertiary.field("unit_id", 4),
    },
    sizeReport: {
      rows: sizeReport.field("rows", 2),
      columns: sizeReport.field("columns", 2),
      cellWidth: sizeReport.field("cell_width", 4),
      cellHeight: sizeReport.field("cell_height", 4),
    },
    rgb: { size: rgb.size, r: rgb.field("r", 1), g: rgb.field("g", 1), b: rgb.field("b", 1) },
    cursor: {
      size: cursor.size,
      sizeField: cursor.field("size", 4),
      inViewport: cursor.field("viewport_has_value", 1),
      x: cursor.field("viewport_x", 2),
      y: cursor.field("viewport_y", 2),
      wideTail: cursor.field("wide_tail", 1),
      visible: cursor.field("visible", 1),
      blinking: cursor.field("blinking", 1),
      style: cursor.field("visual_style", 4),
    },
    colors: {
      size: colors.size,
      sizeField: colors.field("size", 4),
      background: colors.field("background", rgb.size),
      foreground: colors.field("foreground", rgb.size),
      cursor: colors.field("cursor", rgb.size),
      cursorHasValue: colors.field("cursor_has_value", 1),
      palette: colors.field("palette", rgb.size * 256),
    },
    rowSelection: {
      size: rowSelection.size,
      sizeField: rowSelection.field("size", 4),
      start: rowSelection.field("start_x", 2),
      end: rowSelection.field("end_x", 2),
    },
    cellsView: {
      size: cellsView.size,
      pointer: cellsView.field("ptr", 4),
      length: cellsView.field("len", 4),
    },
    cell: {
      size: manifest.typeSize("GhosttyCell", 8),
      contentTag: manifest.packedField("GhosttyCell", ["content_tag"]),
      codepoint: manifest.packedField("GhosttyCell", ["content", "CODEPOINT", "codepoint"]),
      paletteIndex: manifest.packedField("GhosttyCell", ["content", "BG_COLOR_PALETTE", "index"]),
      red: manifest.packedField("GhosttyCell", ["content", "BG_COLOR_RGB", "r"]),
      green: manifest.packedField("GhosttyCell", ["content", "BG_COLOR_RGB", "g"]),
      blue: manifest.packedField("GhosttyCell", ["content", "BG_COLOR_RGB", "b"]),
      styleId: manifest.packedField("GhosttyCell", ["style_id"]),
      wide: manifest.packedField("GhosttyCell", ["wide"]),
    },
    style: {
      size: style.size,
      sizeField: style.field("size", 4),
      foreground: style.field("fg_color", styleColor.size),
      background: style.field("bg_color", styleColor.size),
      underlineColor: style.field("underline_color", styleColor.size),
      bold: style.field("bold", 1),
      italic: style.field("italic", 1),
      faint: style.field("faint", 1),
      blink: style.field("blink", 1),
      inverse: style.field("inverse", 1),
      invisible: style.field("invisible", 1),
      strikethrough: style.field("strikethrough", 1),
      overline: style.field("overline", 1),
      underline: style.field("underline", 4),
    },
    styleColor: {
      tag: styleColor.field("tag", 4),
      palette: styleColor.field("value") + styleColorValue.field("palette", 1),
      rgb: styleColor.field("value") + styleColorValue.field("rgb", rgb.size),
    },
    mouseSize: {
      size: mouseSize.size,
      sizeField: mouseSize.field("size", 4),
      screenWidth: mouseSize.field("screen_width", 4),
      screenHeight: mouseSize.field("screen_height", 4),
      cellWidth: mouseSize.field("cell_width", 4),
      cellHeight: mouseSize.field("cell_height", 4),
    },
    mousePosition: {
      size: mousePosition.size,
      x: mousePosition.field("x", 4),
      y: mousePosition.field("y", 4),
    },
    point: {
      size: point.size,
      tag: point.field("tag", 4),
      x: coordinateOffset + coordinate.field("x", 2),
      y: coordinateOffset + coordinate.field("y", 4),
    },
    coordinate: { size: coordinate.size, x: coordinate.field("x", 2), y: coordinate.field("y", 4) },
    gridRef: { size: gridRef.size, sizeField: gridRef.field("size", 4) },
    selection: {
      size: selection.size,
      sizeField: selection.field("size", 4),
      start: selection.field("start", gridRef.size),
      end: selection.field("end", gridRef.size),
      rectangle: selection.field("rectangle", 1),
    },
    surfacePosition: {
      size: surfacePosition.size,
      x: surfacePosition.field("x", 8),
      y: surfacePosition.field("y", 8),
    },
    geometry: {
      size: geometry.size,
      columns: geometry.field("columns", 4),
      cellWidth: geometry.field("cell_width", 4),
      paddingLeft: geometry.field("padding_left", 4),
      screenHeight: geometry.field("screen_height", 4),
    },
    formatOptions: {
      size: formatOptions.size,
      sizeField: formatOptions.field("size", 4),
      emit: formatOptions.field("emit", 4),
      unwrap: formatOptions.field("unwrap", 1),
      trim: formatOptions.field("trim", 1),
      selection: formatOptions.field("selection", 4),
    },
    paste: {
      size: paste.size,
      sizeField: paste.field("size", 4),
      location: paste.field("location", 4),
      source: paste.field("source", 4),
      mimes: paste.field("mimes", 4),
      mimeCount: paste.field("mimes_len", 4),
      read: paste.field("reader", mimeReader.size) + mimeReader.field("read", 4),
      readUserdata: paste.field("reader", mimeReader.size) + mimeReader.field("userdata", 4),
      allowUnsafe: paste.field("allow_unsafe", 1),
    },
    writer: { write: writer.field("write", 4), userdata: writer.field("userdata", 4) },
    string: { size: string.size, pointer: string.field("ptr", 4), length: string.field("len", 4) },
  };
}

export function readKeys(manifest: Manifest): ReadonlyMap<string, number> {
  const keys = manifest.enumValues("GhosttyKey");

  return new Map(
    [...keys].map(([name, value]) => {
      const words = name.split("_").map((word) => word.charAt(0) + word.slice(1).toLowerCase());

      return [name.length === 1 ? `Key${name}` : words.join(""), value];
    }),
  );
}

function checkEnums(manifest: Manifest) {
  Object.entries(manifestEnums).forEach(([type, expected]) => {
    const values = manifest.enumValues(type);

    Object.entries(expected).forEach(([name, value]) => {
      const actual = values.get(name);

      if (actual !== value) {
        throw new Error(
          `libghostty-vt enum ${type}.${name} is ${actual ?? "missing"}, expected ${value}`,
        );
      }
    });
  });
}
