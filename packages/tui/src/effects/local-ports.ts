import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { imageInfo } from "@opentui/core";
import { DirectoryListing, directorySuggestions } from "../lib/directory-completion.ts";
import type { MentionFile } from "../model/completion.ts";
import type { DraftInsert, DraftPart } from "../model/draft.ts";
import { editInExternalEditor, resolveExternalEditor } from "../services/external-editor.ts";
import { startLocalShell } from "../services/local-shell.ts";
import type { ShellProcess } from "../services/local-shell.ts";
import { FileSettingsStore } from "../services/settings.ts";
import type { Clock, FilesPort, Handle, SettingsPort, ShellEnd, ShellPort } from "./ports.ts";

const PASTE_COLLAPSE_LINES = 8;

const MAX_ATTACHMENT_BYTES = 256_000;

const IMAGE_EXTENSIONS = new Set([".gif", ".jpeg", ".jpg", ".png", ".webp"]);

export function createHandle<T>(): Handle<T> {
  let current: T | null = null;

  return {
    attach(value) {
      current = value;

      return () => {
        if (current === value) current = null;
      };
    },
    current: () => current,
  };
}

export const systemClock: Clock = { now: () => Date.now() };

export function shellPort(): ShellPort {
  const processes = new Map<string, ShellProcess>();

  return {
    async start(id, command, cwd, update) {
      const controller = new AbortController();

      const shell = startLocalShell({
        command,
        cwd,
        signal: controller.signal,
        onUpdate: (snapshot) => update(snapshot.output),
      });

      processes.set(id, shell);

      try {
        const end = await shell.done;
        update(end.output);

        return shellEnd(end);
      } finally {
        processes.delete(id);
      }
    },
    stop(id) {
      processes.get(id)?.cancel();
    },
  };
}

function shellEnd(end: Awaited<ShellProcess["done"]>): ShellEnd {
  switch (end.state) {
    case "exited":
      return { kind: "exited", code: end.exitCode };
    case "signalled":
      return { kind: "signalled", signal: end.signal };
    case "cancelled":
      return { kind: "cancelled" };
    case "failed":
      return { kind: "failed", message: end.message };
    default: {
      const _exhaustive: never = end;

      return _exhaustive;
    }
  }
}

export function filesPort(): FilesPort {
  const listing = new DirectoryListing();

  return {
    resolvePaste,
    listDirectory: (path, cwd) => directorySuggestions({ path, cwd }, listing),
    resolveMention,
    readText: readAttachmentText,
    async editor(text, command) {
      const result = await editInExternalEditor(text, resolveExternalEditor(command ?? undefined));

      if (result.status === "failed") throw result.error;

      return result.text;
    },
  };
}

export function settingsPort(): SettingsPort {
  const store = new FileSettingsStore();

  return {
    read: (cwd) => store.read(cwd),
    async write(cwd, patch) {
      await store.updateGlobal(patch);

      return store.read(cwd);
    },
  };
}

export async function resolvePaste(
  text: string,
  bytes: Uint8Array | null,
  cwd: string,
): Promise<DraftInsert> {
  if (bytes !== null) {
    const image = imagePart(bytes);

    return image === null
      ? { kind: "refused", reason: "Unsupported image data" }
      : { kind: "part", part: image };
  }

  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const path = pastedPath(normalized, cwd);
  const info = path === null ? undefined : await stat(path).catch(() => undefined);

  if (path !== null && info?.isFile() === true) {
    if (!IMAGE_EXTENSIONS.has(extname(path).toLowerCase()))
      return { kind: "part", part: { kind: "file", path, directory: false } };
    const data = await readFile(path).catch(() => undefined);
    const image = data === undefined ? null : imagePart(data);

    return image === null
      ? { kind: "part", part: { kind: "file", path, directory: false } }
      : { kind: "part", part: image };
  }

  return normalized.split("\n").length > PASTE_COLLAPSE_LINES
    ? { kind: "part", part: { kind: "paste", text: normalized } }
    : { kind: "text", text: normalized };
}

function imagePart(bytes: Uint8Array): Extract<DraftPart, { readonly kind: "image" }> | null {
  const mime = imageMimeType(bytes);

  return mime === null ? null : { kind: "image", bytes, blob: null, mime };
}

function imageMimeType(data: Uint8Array): string | null {
  let format: ReturnType<typeof imageInfo>["format"];

  try {
    format = imageInfo(data).format;
  } catch {
    return null;
  }

  switch (format) {
    case "png":
      return "image/png";
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "raw-rgba":
      return null;
    default: {
      const _exhaustive: never = format;

      return _exhaustive;
    }
  }
}

function pastedPath(value: string, cwd: string): string | null {
  const trimmed = value.trim();

  if (trimmed === "" || trimmed.includes("\n")) return null;
  const raw = trimmed.replace(/^['"]+|['"]+$/g, "");

  if (raw.startsWith("file://")) {
    try {
      return fileURLToPath(raw);
    } catch {
      return null;
    }
  }

  return resolve(cwd, process.platform === "win32" ? raw : raw.replace(/\\(.)/g, "$1"));
}

export async function resolveMention(query: string, cwd: string): Promise<MentionFile | null> {
  const path = resolve(cwd, query.startsWith("~") ? join(homedir(), query.slice(2)) : query);
  const info = await stat(path).catch(() => undefined);

  if (info === undefined) return null;
  const display = relative(cwd, path).split("\\").join("/");

  if (info.isDirectory())
    return {
      path: `${path}/`,
      display: display === "" ? "./" : `${display}/`,
      label: `${basename(path)}/`,
    };

  return info.isFile() ? { path, display, label: basename(path) } : null;
}

async function readAttachmentText(path: string): Promise<string | null> {
  const info = await stat(path).catch(() => undefined);

  if (info === undefined || !info.isFile() || info.size > MAX_ATTACHMENT_BYTES) return null;
  const bytes = await readFile(path).catch(() => undefined);

  if (bytes === undefined || bytes.byteLength > MAX_ATTACHMENT_BYTES || bytes.includes(0))
    return null;
  const text = bytes.toString("utf8");

  return text.includes("</file>") ? null : text;
}
