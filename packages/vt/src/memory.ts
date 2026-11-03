import { Result } from "./constants.ts";

import type { Native } from "./native.ts";

export interface Memory {
  readonly bytes: () => Uint8Array;
  readonly view: () => DataView;
  readonly allocate: (size: number) => number;
  readonly growable: (initial: number) => Growable;
  readonly handle: (create: (slot: number) => number, what: string) => number;
  readonly copy: (pointer: number, length: number) => Uint8Array;
  readonly text: (pointer: number, length: number) => string;
  readonly sized: (pointer: number, struct: SizedStruct) => number;
}

interface SizedStruct {
  readonly size: number;
  readonly sizeField: number;
}

interface Growable {
  readonly pointer: () => number;
  readonly capacity: () => number;
  readonly reserve: (size: number) => number;
}

export function createMemory(native: Native): Memory {
  const slot = native.ghostty_wasm_alloc_opaque();
  const decoder = new TextDecoder();
  let buffer = native.memory.buffer;
  let length = buffer.byteLength;
  let bytes = new Uint8Array(buffer);
  let view = new DataView(buffer);

  if (slot === 0) throw new Error("libghostty-vt is out of memory");

  const refresh = () => {
    if (native.memory.buffer === buffer && native.memory.buffer.byteLength === length) return;
    buffer = native.memory.buffer;
    length = buffer.byteLength;
    bytes = new Uint8Array(buffer);
    view = new DataView(buffer);
  };

  const allocate = (size: number) => {
    const pointer = native.ghostty_wasm_alloc(size);

    if (pointer === 0) throw new Error("libghostty-vt is out of memory");
    refresh();
    bytes.fill(0, pointer, pointer + size);

    return pointer;
  };

  return {
    bytes: () => {
      refresh();

      return bytes;
    },
    view: () => {
      refresh();

      return view;
    },
    allocate,
    growable: (initial) => {
      let pointer = allocate(initial);
      let capacity = initial;

      return {
        pointer: () => pointer,
        capacity: () => capacity,
        reserve: (size) => {
          if (size <= capacity) return pointer;
          const next = Math.max(size, capacity * 2);

          native.ghostty_wasm_free(pointer, capacity);
          pointer = allocate(next);
          capacity = next;

          return pointer;
        },
      };
    },
    handle: (create, what) => {
      check(create(slot), what);

      return native.ghostty_wasm_take_opaque(slot);
    },
    copy: (pointer, size) => {
      refresh();

      return bytes.slice(pointer, pointer + size);
    },
    sized: (pointer, struct) => {
      refresh();
      view.setUint32(pointer + struct.sizeField, struct.size, true);

      return pointer;
    },
    text: (pointer, size) => {
      refresh();

      return decoder.decode(bytes.subarray(pointer, pointer + size));
    },
  };
}

export function check(result: number, what: string) {
  if (result !== Result.SUCCESS)
    throw new Error(`libghostty-vt ${what} failed with result ${result}`);
}
