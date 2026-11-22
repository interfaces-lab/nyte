import { createReadStream, createWriteStream } from "node:fs";
import { chmod, copyFile, mkdir, open, symlink, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { createGunzip, inflateRaw } from "node:zlib";
import type { ArchiveFormat } from "./spec.ts";

const BLOCK = 512;

const ZIP_END = 0x06_05_4b_50;

const ZIP_ENTRY = 0x02_01_4b_50;

const ZIP_END_BYTES = 22;

const ZIP_COMMENT_LIMIT = 0xff_ff;

const ZIP64 = 0xff_ff_ff_ff;

const SYMLINK = 0o12_0000;

const KIND_MASK = 0o17_0000;

const decoder = new TextDecoder();

const inflate = promisify(inflateRaw);

export async function unpack(
  file: string,
  format: ArchiveFormat,
  folder: string,
  name: string,
): Promise<void> {
  if (format === "file") return copyFile(file, await place(folder, name));

  if (format === "gz") {
    return pipeline(
      createReadStream(file),
      createGunzip(),
      createWriteStream(await place(folder, name)),
    );
  }

  if (format === "zip") return unzip(file, folder);
  const packed = createReadStream(file);
  const unpacked = createGunzip();

  packed.on("error", (error) => unpacked.destroy(error));
  packed.pipe(unpacked);

  return untar(unpacked, folder, 0);
}

/** Unpacks a tar as it arrives, so an archive of any size holds only one chunk in memory. */
export async function untar(
  source: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  folder: string,
  strip: number,
): Promise<void> {
  const chunks =
    Symbol.asyncIterator in source ? source[Symbol.asyncIterator]() : source[Symbol.iterator]();

  let held: Uint8Array = new Uint8Array(0);
  let long: string | null = null;
  let extended: string | null = null;

  const some = async (limit: number): Promise<Uint8Array | null> => {
    if (held.byteLength === 0) {
      const next = await chunks.next();

      if (next.done === true) return null;
      held = next.value;
    }

    const part = held.subarray(0, limit);
    held = held.subarray(part.byteLength);

    return part;
  };

  const exactly = async (length: number): Promise<Uint8Array> => {
    const parts: Uint8Array[] = [];

    for (let left = length; left > 0;) {
      const part = await some(left);

      if (part === null) throw new Error("The archive is cut short.");
      parts.push(part);
      left -= part.byteLength;
    }

    return parts.length === 1 && parts[0] !== undefined ? parts[0] : Buffer.concat(parts);
  };

  for (;;) {
    const start = await some(BLOCK);

    if (start === null) return;

    const header =
      start.byteLength === BLOCK
        ? start
        : Buffer.concat([start, await exactly(BLOCK - start.byteLength)]);

    if (header.every((byte) => byte === 0)) return;
    const size = Number.parseInt(field(header, 124, 12), 8) || 0;
    const padding = Math.ceil(size / BLOCK) * BLOCK - size;
    const kind = String.fromCodePoint(header[156] ?? 0);

    if (kind === "L" || kind === "x") {
      const body = await exactly(size);

      await exactly(padding);

      if (kind === "L") long = field(body, 0, body.byteLength);
      else extended = readPaxPath(body);
      continue;
    }

    const prefix = field(header, 345, 155);
    const short = field(header, 0, 100);
    const name = extended ?? long ?? (prefix === "" ? short : `${prefix}/${short}`);
    const kept = kind === "g" ? "" : name.split("/").slice(strip).join("/");

    if (kind !== "g") {
      long = null;
      extended = null;
    }

    if (kept !== "" && (kind === "0" || kind === "\0")) {
      const handle = await open(
        await place(folder, kept),
        "w",
        Number.parseInt(field(header, 100, 8), 8) || 0o644,
      );

      try {
        for (let left = size; left > 0;) {
          const part = await some(left);

          if (part === null) throw new Error("The archive is cut short.");
          await handle.write(part);
          left -= part.byteLength;
        }
      } finally {
        await handle.close();
      }

      await exactly(padding);
      continue;
    }

    await exactly(size + padding);

    if (kept !== "" && kind === "2") {
      await symlink(field(header, 157, 100), await place(folder, kept));
    }
  }
}

async function unzip(file: string, folder: string): Promise<void> {
  const handle = await open(file, "r");

  try {
    const size = (await handle.stat()).size;
    const tail = await read(handle, Math.max(0, size - ZIP_END_BYTES - ZIP_COMMENT_LIMIT), size);
    let end = tail.byteLength - ZIP_END_BYTES;

    while (end >= 0 && tail.readUInt32LE(end) !== ZIP_END) end -= 1;

    if (end < 0) throw new Error("The download is not a zip archive.");
    const count = tail.readUInt16LE(end + 10);
    const start = tail.readUInt32LE(end + 16);

    if (start === ZIP64) throw new Error("The download is a zip64 archive, which is not read yet.");
    const directory = await read(handle, start, start + tail.readUInt32LE(end + 12));
    let at = 0;

    for (let index = 0; index < count; index += 1) {
      if (directory.readUInt32LE(at) !== ZIP_ENTRY) throw new Error("The zip's directory is cut.");
      const method = directory.readUInt16LE(at + 10);
      const packed = directory.readUInt32LE(at + 20);
      const nameBytes = directory.readUInt16LE(at + 28);
      const mode = directory.readUInt32LE(at + 38) >>> 16;
      const local = directory.readUInt32LE(at + 42);
      const name = decoder.decode(directory.subarray(at + 46, at + 46 + nameBytes));
      at += 46 + nameBytes + directory.readUInt16LE(at + 30) + directory.readUInt16LE(at + 32);

      if (name.endsWith("/")) continue;
      const lead = await read(handle, local, local + 30);
      const data = local + 30 + lead.readUInt16LE(26) + lead.readUInt16LE(28);
      const stored = await read(handle, data, data + packed);
      const body = method === 0 ? stored : await inflate(stored);
      const target = await place(folder, name);

      if ((mode & KIND_MASK) === SYMLINK) await symlink(decoder.decode(body), target);
      else {
        await writeFile(target, body);
        await chmod(target, (mode & 0o777) === 0 ? 0o644 : mode & 0o777);
      }
    }
  } finally {
    await handle.close();
  }
}

async function read(handle: FileHandle, from: number, to: number): Promise<Buffer> {
  const buffer = Buffer.alloc(to - from);
  await handle.read(buffer, 0, buffer.byteLength, from);

  return buffer;
}

async function place(folder: string, name: string): Promise<string> {
  const target = resolve(folder, name);
  const inside = relative(folder, target);

  if (inside === "" || inside === ".." || inside.startsWith(`..${sep}`)) {
    throw new Error(`The archive names ${name}, which is outside the folder it unpacks into.`);
  }

  await mkdir(dirname(target), { recursive: true });

  return join(folder, inside);
}

function field(bytes: Uint8Array, start: number, length: number): string {
  const slice = bytes.subarray(start, start + length);
  const end = slice.indexOf(0);

  return decoder.decode(end < 0 ? slice : slice.subarray(0, end)).trim();
}

function readPaxPath(body: Uint8Array): string | null {
  const record = decoder
    .decode(body)
    .split("\n")
    .find((line) => /^\d+ path=/.test(line));

  return record === undefined ? null : record.slice(record.indexOf("=") + 1);
}
