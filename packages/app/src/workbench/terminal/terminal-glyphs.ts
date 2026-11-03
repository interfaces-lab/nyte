interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly thickness: number;
}

const LINES = [
  "0101 0202 1010 2020 0101 0202 1010 2020 0101 0202 1010 2020 0110 0210 0120 0220",
  "0011 0012 0021 0022 1100 1200 2100 2200 1001 1002 2001 2002 1110 1210 2110 1120",
  "2120 2210 1220 2220 1011 1012 2011 1021 2021 2012 1022 2022 0111 0112 0211 0212",
  "0121 0122 0221 0222 1101 1102 1201 1202 2101 2102 2201 2202 1111 1112 1211 1212",
  "2111 1121 2121 2112 2211 1122 1221 2212 1222 2122 2221 2222 0101 0202 1010 2020",
  "0303 3030 0310 0130 0330 0013 0031 0033 1300 3100 3300 1003 3001 3003 1310 3130",
  "3330 1013 3031 3033 0313 0131 0333 1303 3101 3303 1313 3131 3333 0110 0011 1001",
  "1100 0000 0000 0000 0001 1000 0100 0010 0002 2000 0200 0020 0201 1020 0102 2010",
]
  .join(" ")
  .split(" ")
  .map((weights) => Array.from(weights, Number));

const DASHES = new Map([
  [0x2504, 3],
  [0x2505, 3],
  [0x2506, 3],
  [0x2507, 3],
  [0x2508, 4],
  [0x2509, 4],
  [0x250a, 4],
  [0x250b, 4],
  [0x254c, 2],
  [0x254d, 2],
  [0x254e, 2],
  [0x254f, 2],
]);

const BLOCKS = new Map<number, readonly (readonly [number, number, number, number])[]>([
  [0x2580, [[0, 0, 8, 4]]],
  [0x2581, [[0, 7, 8, 8]]],
  [0x2582, [[0, 6, 8, 8]]],
  [0x2583, [[0, 5, 8, 8]]],
  [0x2584, [[0, 4, 8, 8]]],
  [0x2585, [[0, 3, 8, 8]]],
  [0x2586, [[0, 2, 8, 8]]],
  [0x2587, [[0, 1, 8, 8]]],
  [0x2588, [[0, 0, 8, 8]]],
  [0x2589, [[0, 0, 7, 8]]],
  [0x258a, [[0, 0, 6, 8]]],
  [0x258b, [[0, 0, 5, 8]]],
  [0x258c, [[0, 0, 4, 8]]],
  [0x258d, [[0, 0, 3, 8]]],
  [0x258e, [[0, 0, 2, 8]]],
  [0x258f, [[0, 0, 1, 8]]],
  [0x2590, [[4, 0, 8, 8]]],
  [0x2594, [[0, 0, 8, 1]]],
  [0x2595, [[7, 0, 8, 8]]],
]);

const SHADES = new Map([
  [0x2591, 0.25],
  [0x2592, 0.5],
  [0x2593, 0.75],
]);

const QUADRANTS = new Map([
  [0x2596, 4],
  [0x2597, 8],
  [0x2598, 1],
  [0x2599, 13],
  [0x259a, 9],
  [0x259b, 7],
  [0x259c, 11],
  [0x259d, 2],
  [0x259e, 6],
  [0x259f, 14],
]);

export function drawGlyph(context: CanvasRenderingContext2D, text: string, box: Box): boolean {
  if (text.length !== 1) return false;
  const code = text.charCodeAt(0);

  if (code >= 0x256d && code <= 0x2570) return drawArc(context, code, box);

  if (code >= 0x2571 && code <= 0x2573) return drawDiagonal(context, code, box);

  if (code >= 0x2500 && code <= 0x257f) return drawLines(context, code, box);

  if (code >= 0x2580 && code <= 0x259f) return drawBlock(context, code, box);

  if (code >= 0xe0b0 && code <= 0xe0b3) return drawPowerline(context, code, box);

  return false;
}

function drawLines(context: CanvasRenderingContext2D, code: number, box: Box): boolean {
  const weights = LINES[code - 0x2500] ?? [];
  const up = weights[0] ?? 0;
  const right = weights[1] ?? 0;
  const down = weights[2] ?? 0;
  const left = weights[3] ?? 0;
  const t = box.thickness;
  const w = box.width;
  const h = box.height;
  const dashes = DASHES.get(code);

  if (dashes !== undefined)
    return drawDashes(context, box, dashes, up === 0 ? right : up, up !== 0);
  const vLightLeft = Math.floor((w - t) / 2);
  const vLightRight = vLightLeft + t;
  const vHeavyLeft = Math.floor((w - 2 * t) / 2);
  const vHeavyRight = vHeavyLeft + 2 * t;
  const vDoubleLeft = vLightLeft - t;
  const vDoubleRight = vLightRight + t;
  const hLightTop = Math.floor((h - t) / 2);
  const hLightBottom = hLightTop + t;
  const hHeavyTop = Math.floor((h - 2 * t) / 2);
  const hHeavyBottom = hHeavyTop + 2 * t;
  const hDoubleTop = hLightTop - t;
  const hDoubleBottom = hLightBottom + t;
  const horizontalDouble = left === 3 || right === 3;
  const verticalDouble = up === 3 || down === 3;

  const upBottom =
    left === 2 || right === 2
      ? hHeavyBottom
      : left !== right || down === up
        ? horizontalDouble
          ? hDoubleBottom
          : hLightBottom
        : left === 0 && right === 0
          ? hLightBottom
          : hLightTop;

  const downTop =
    left === 2 || right === 2
      ? hHeavyTop
      : left !== right || up === down
        ? horizontalDouble
          ? hDoubleTop
          : hLightTop
        : left === 0 && right === 0
          ? hLightTop
          : hLightBottom;

  const leftRight =
    up === 2 || down === 2
      ? vHeavyRight
      : up !== down || left === right
        ? verticalDouble
          ? vDoubleRight
          : vLightRight
        : up === 0 && down === 0
          ? vLightRight
          : vLightLeft;

  const rightLeft =
    up === 2 || down === 2
      ? vHeavyLeft
      : up !== down || right === left
        ? verticalDouble
          ? vDoubleLeft
          : vLightLeft
        : up === 0 && down === 0
          ? vLightLeft
          : vLightRight;

  const rect = (x0: number, y0: number, x1: number, y1: number): void => {
    if (x1 > x0 && y1 > y0) context.fillRect(box.x + x0, box.y + y0, x1 - x0, y1 - y0);
  };

  if (up === 1) rect(vLightLeft, 0, vLightRight, upBottom);

  if (up === 2) rect(vHeavyLeft, 0, vHeavyRight, upBottom);

  if (up === 3) {
    rect(vDoubleLeft, 0, vLightLeft, left === 3 ? hLightTop : upBottom);
    rect(vLightRight, 0, vDoubleRight, right === 3 ? hLightTop : upBottom);
  }

  if (right === 1) rect(rightLeft, hLightTop, w, hLightBottom);

  if (right === 2) rect(rightLeft, hHeavyTop, w, hHeavyBottom);

  if (right === 3) {
    rect(up === 3 ? vLightRight : rightLeft, hDoubleTop, w, hLightTop);
    rect(down === 3 ? vLightRight : rightLeft, hLightBottom, w, hDoubleBottom);
  }

  if (down === 1) rect(vLightLeft, downTop, vLightRight, h);

  if (down === 2) rect(vHeavyLeft, downTop, vHeavyRight, h);

  if (down === 3) {
    rect(vDoubleLeft, left === 3 ? hLightBottom : downTop, vLightLeft, h);
    rect(vLightRight, right === 3 ? hLightBottom : downTop, vDoubleRight, h);
  }

  if (left === 1) rect(0, hLightTop, leftRight, hLightBottom);

  if (left === 2) rect(0, hHeavyTop, leftRight, hHeavyBottom);

  if (left === 3) {
    rect(0, hDoubleTop, up === 3 ? vLightLeft : leftRight, hLightTop);
    rect(0, hLightBottom, down === 3 ? vLightLeft : leftRight, hDoubleBottom);
  }

  return true;
}

function drawDashes(
  context: CanvasRenderingContext2D,
  box: Box,
  count: number,
  weight: number,
  vertical: boolean,
): boolean {
  const stroke = box.thickness * weight;
  const length = vertical ? box.height : box.width;
  const across = vertical ? box.width : box.height;
  const gap = Math.max(1, Math.round(length / (count * 3)));
  const offset = Math.floor((across - stroke) / 2);

  for (let index = 0; index < count; index += 1) {
    const start = Math.round((index * length) / count + gap / 2);
    const end = Math.round(((index + 1) * length) / count - gap / 2);

    if (vertical) context.fillRect(box.x + offset, box.y + start, stroke, end - start);
    else context.fillRect(box.x + start, box.y + offset, end - start, stroke);
  }

  return true;
}

function centerLine(box: Box) {
  return {
    x: box.x + Math.floor((box.width - box.thickness) / 2) + box.thickness / 2,
    y: box.y + Math.floor((box.height - box.thickness) / 2) + box.thickness / 2,
  };
}

function drawArc(context: CanvasRenderingContext2D, code: number, box: Box): boolean {
  const center = centerLine(box);
  const radius = Math.min(box.width, box.height) / 2;
  const top = code === 0x256f || code === 0x2570;
  const toRight = code === 0x256d || code === 0x2570;
  const edge = toRight ? box.x + box.width : box.x;
  context.lineWidth = box.thickness;
  context.lineCap = "butt";
  context.strokeStyle = context.fillStyle;
  context.beginPath();
  context.moveTo(center.x, top ? box.y : box.y + box.height);
  context.arcTo(center.x, center.y, edge, center.y, radius);
  context.lineTo(edge, center.y);
  context.stroke();

  return true;
}

function drawDiagonal(context: CanvasRenderingContext2D, code: number, box: Box): boolean {
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  context.lineWidth = box.thickness;
  context.lineCap = "square";
  context.strokeStyle = context.fillStyle;
  context.beginPath();

  if (code !== 0x2572) {
    context.moveTo(right, box.y);
    context.lineTo(box.x, bottom);
  }

  if (code !== 0x2571) {
    context.moveTo(box.x, box.y);
    context.lineTo(right, bottom);
  }

  context.stroke();

  return true;
}

function drawBlock(context: CanvasRenderingContext2D, code: number, box: Box): boolean {
  const eighthX = (value: number): number => box.x + Math.round((box.width * value) / 8);
  const eighthY = (value: number): number => box.y + Math.round((box.height * value) / 8);

  const fill = (rect: readonly [number, number, number, number]): void => {
    const x = eighthX(rect[0]);
    const y = eighthY(rect[1]);
    context.fillRect(x, y, eighthX(rect[2]) - x, eighthY(rect[3]) - y);
  };

  const shade = SHADES.get(code);

  if (shade !== undefined) {
    const alpha = context.globalAlpha;
    context.globalAlpha = alpha * shade;
    fill([0, 0, 8, 8]);
    context.globalAlpha = alpha;

    return true;
  }

  const quadrants = QUADRANTS.get(code);

  if (quadrants !== undefined) {
    const parts: readonly (readonly [number, number, number, number])[] = [
      [0, 0, 4, 4],
      [4, 0, 8, 4],
      [0, 4, 4, 8],
      [4, 4, 8, 8],
    ];

    parts.filter((_, index) => (quadrants & (1 << index)) !== 0).forEach(fill);

    return true;
  }

  const rects = BLOCKS.get(code);

  if (rects === undefined) return false;
  rects.forEach(fill);

  return true;
}

function drawPowerline(context: CanvasRenderingContext2D, code: number, box: Box): boolean {
  const solid = code === 0xe0b0 || code === 0xe0b2;
  const pointsRight = code === 0xe0b0 || code === 0xe0b1;
  const base = pointsRight ? box.x : box.x + box.width;
  const tip = pointsRight ? box.x + box.width : box.x;
  const inset = solid ? 0 : box.thickness / 2;
  context.beginPath();
  context.moveTo(base, box.y + inset);
  context.lineTo(tip - (pointsRight ? inset : -inset), box.y + box.height / 2);
  context.lineTo(base, box.y + box.height - inset);

  if (solid) {
    context.closePath();
    context.fill();

    return true;
  }

  context.lineWidth = box.thickness;
  context.lineJoin = "miter";
  context.strokeStyle = context.fillStyle;
  context.stroke();

  return true;
}
