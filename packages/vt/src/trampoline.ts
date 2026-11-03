interface Signature {
  readonly params: number;
  readonly returns: boolean;
}

export type Callback = (...args: number[]) => number | void;

const callbackNames = [
  "writePty",
  "titleChanged",
  "size",
  "colorScheme",
  "deviceAttributes",
  "renderHold",
  "randomSecure",
  "readMime",
] as const;

export type CallbackName = (typeof callbackNames)[number];

const callbackSignatures: Readonly<Record<CallbackName, Signature>> = {
  writePty: { params: 4, returns: false },
  titleChanged: { params: 2, returns: false },
  size: { params: 3, returns: true },
  colorScheme: { params: 3, returns: true },
  deviceAttributes: { params: 3, returns: true },
  renderHold: { params: 3, returns: false },
  randomSecure: { params: 3, returns: true },
  readMime: { params: 3, returns: true },
};

const i32 = 0x7f;

export function encodeTrampolines(): Uint8Array<ArrayBuffer> {
  const signatures = callbackNames.map((name) => callbackSignatures[name]);

  const keys = [
    ...new Set(signatures.map((signature) => `${signature.params}:${signature.returns}`)),
  ];

  const typeIndex = signatures.map((signature) =>
    keys.indexOf(`${signature.params}:${signature.returns}`),
  );

  const types = keys.map((key) => {
    const parts = key.split(":");

    return [
      0x60,
      ...vector(Array.from({ length: Number(parts[0]) }, () => [i32])),
      ...vector(parts[1] === "true" ? [[i32]] : []),
    ];
  });

  const imports = signatures.map((_, index) => [
    ...text("t"),
    ...text(String(index)),
    0x00,
    ...unsigned(typeIndex[index] ?? 0),
  ]);

  const exports = signatures.map((_, index) => [
    ...text(String(index)),
    0x00,
    ...unsigned(signatures.length + index),
  ]);

  const bodies = signatures.map((signature, index) => {
    const body = [
      0x00,
      ...Array.from({ length: signature.params }, (_, param) => [0x20, ...unsigned(param)]).flat(),
      0x10,
      ...unsigned(index),
      0x0b,
    ];

    return [...unsigned(body.length), ...body];
  });

  return new Uint8Array([
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00,
    ...section(1, vector(types)),
    ...section(2, vector(imports)),
    ...section(3, vector(typeIndex.map((index) => unsigned(index)))),
    ...section(7, vector(exports)),
    ...section(10, vector(bodies)),
  ]);
}

export async function installTrampolines(
  module: WebAssembly.Module,
  table: WebAssembly.Table,
  handlers: Readonly<Record<CallbackName, Callback>>,
): Promise<(name: CallbackName) => number> {
  const instance = await WebAssembly.instantiate(module, {
    t: Object.fromEntries(callbackNames.map((name, index) => [String(index), handlers[name]])),
  });

  const base = table.grow(callbackNames.length);

  callbackNames.forEach((_, index) => {
    const trampoline = instance.exports[String(index)];

    if (!(trampoline instanceof Function)) throw new Error(`trampoline ${index} is missing`);
    table.set(base + index, trampoline);
  });

  return (name) => base + callbackNames.indexOf(name);
}

function section(id: number, payload: readonly number[]) {
  return [id, ...unsigned(payload.length), ...payload];
}

function vector(items: readonly (readonly number[])[]) {
  return [...unsigned(items.length), ...items.flat()];
}

function text(value: string) {
  return vector([...new TextEncoder().encode(value)].map((byte) => [byte]));
}

function unsigned(value: number): number[] {
  const low = value & 0x7f;
  const rest = value >>> 7;

  return rest === 0 ? [low] : [low | 0x80, ...unsigned(rest)];
}
