export interface Manifest {
  readonly struct: (name: string) => Struct;
  readonly enumValues: (name: string) => ReadonlyMap<string, number>;
  readonly packedField: (name: string, path: readonly string[]) => Bits;
  readonly typeSize: (name: string, expected: number) => number;
}

interface Struct {
  readonly size: number;
  readonly field: (name: string, size?: number) => number;
}

export interface Bits {
  readonly lsb: number;
  readonly width: number;
}

type Json = string | number | boolean | null | Json[] | { readonly [key: string]: Json };

export function parseManifest(json: string): Manifest {
  const parsed: Json = JSON.parse(json);
  const root = readObject(parsed, "manifest");
  const abi = readObject(root.get("abi"), "manifest abi");

  if (readNumber(root.get("schema"), "manifest schema") !== 1) {
    throw new Error("libghostty-vt manifest has an unsupported schema version");
  }

  if (
    readNumber(abi.get("pointer_size"), "abi.pointer_size") !== 4 ||
    readNumber(abi.get("usize_size"), "abi.usize_size") !== 4 ||
    abi.get("endian") !== "little"
  ) {
    throw new Error("libghostty-vt is not a little-endian wasm32 build");
  }

  const types = readObject(root.get("types"), "manifest types");
  const type = (name: string) => readObject(types.get(name), `libghostty-vt type ${name}`);

  return {
    struct: (name) => {
      const descriptor = type(name);
      const fields = readObject(descriptor.get("fields"), `${name} fields`);

      return {
        size: readNumber(descriptor.get("size"), `${name} size`),
        field: (field, size) => {
          const entry = readObject(fields.get(field), `libghostty-vt field ${name}.${field}`);
          const actual = readNumber(entry.get("size"), `${name}.${field} size`);

          if (size !== undefined && actual !== size) {
            throw new Error(
              `libghostty-vt field ${name}.${field} is ${actual} bytes, expected ${size}`,
            );
          }

          return readNumber(entry.get("offset"), `${name}.${field} offset`);
        },
      };
    },
    enumValues: (name) => {
      const values = readObject(type(name).get("values"), `${name} values`);

      return new Map([...values].map(([key, value]) => [key, readNumber(value, `${name}.${key}`)]));
    },
    typeSize: (name, expected) => {
      const size = readNumber(type(name).get("size"), `${name} size`);

      if (size !== expected)
        throw new Error(`libghostty-vt type ${name} is ${size} bytes, expected ${expected}`);

      return size;
    },
    packedField: (name, path) => {
      const what = `libghostty-vt packed field ${name}.${path.join(".")}`;

      const found = path.reduce(
        (entry, segment) => {
          const next = packedChild(entry.node, segment, what);
          const lsb = next.get("lsb");

          return { node: next, lsb: entry.lsb + (lsb === undefined ? 0 : readNumber(lsb, what)) };
        },
        { node: type(name), lsb: 0 },
      );

      return { lsb: found.lsb, width: readNumber(found.node.get("width"), what) };
    },
  };
}

function packedChild(
  node: ReadonlyMap<string, Json>,
  segment: string,
  what: string,
): ReadonlyMap<string, Json> {
  const bits = node.get("bits");

  return readObject(
    readObject(bits === undefined ? node.get("arms") : bits, what).get(segment),
    what,
  );
}

function readObject(value: Json | undefined, what: string): ReadonlyMap<string, Json> {
  if (!(value instanceof Object) || Array.isArray(value)) throw new Error(`${what} is missing`);

  return new Map(Object.entries(value));
}

function readNumber(value: Json | undefined, what: string): number {
  if (!Number.isFinite(value)) throw new Error(`${what} is not a number`);

  return Number(value);
}
