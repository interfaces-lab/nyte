import type { BlobId, ExcerptSource, UserContent } from "@nyte-ai/schema";
import type { ImageContent, TextContent, UserMessage } from "@nyte-ai/schema/model";
import type { Kernel } from "../contract/kernel.ts";
import type { StoreConnection } from "../contract/store.ts";
import { modelImage } from "./images.ts";

const IMAGE_CACHE_CHARS = 64 * 1024 * 1024;

const imageCache = new WeakMap<Kernel, Map<BlobId, readonly (TextContent | ImageContent)[]>>();

export async function userContent(
  kernel: Kernel,
  content: UserContent,
  images: boolean,
): Promise<UserMessage["content"]> {
  if (typeof content === "string") return content;

  const parts = await Promise.all(
    content.map((item): Promise<readonly (TextContent | ImageContent)[]> => {
      switch (item.kind) {
        case "text":
          return Promise.resolve([{ type: "text", text: item.text }]);
        case "file":
          return fileContent(kernel, item, images);
        case "reference":
          return mentionContent(kernel.store, item).then((mention) => [mention]);
        case "skill":
          return Promise.resolve([
            {
              type: "text",
              text: `<skill name="${escapeAttribute(item.name)}" location="${escapeAttribute(item.location)}">\nRead the skill's file at its location and follow it.\n</skill>`,
            },
          ]);
        case "excerpt":
          return Promise.resolve([
            {
              type: "text",
              text: `<excerpt ${excerptAttributes(item.source)}>\n${fencedExcerpt(item.text)}\n</excerpt>`,
            },
          ]);
        default: {
          const exhaustive: never = item;

          return exhaustive;
        }
      }
    }),
  );

  return parts.flat();
}

export async function fileContent(
  kernel: Kernel,
  file: { readonly blob: BlobId; readonly mime: string; readonly name?: string },
  images: boolean,
): Promise<readonly (TextContent | ImageContent)[]> {
  const name = file.name ?? file.blob;
  const image = images && file.mime.startsWith("image/");
  const cache =
    imageCache.get(kernel) ?? new Map<BlobId, readonly (TextContent | ImageContent)[]>();
  imageCache.set(kernel, cache);
  const cached = image ? cache.get(file.blob) : undefined;

  if (cached !== undefined) {
    cache.delete(file.blob);
    cache.set(file.blob, cached);

    return cached.map((part) => ({ ...part }));
  }

  const reader = await kernel.store.objects.blob(file.blob);

  if (reader === null) {
    return [{ type: "text", text: `[File ${name}, ${file.mime}: no longer stored]` }];
  }

  try {
    if (!image) {
      return [
        {
          type: "text",
          text: `[File ${name}, ${reader.size === null ? "unknown size" : `${reader.size} bytes`}, ${file.mime}]`,
        },
      ];
    }
    const chunks: Uint8Array[] = [];

    for await (const chunk of reader.chunks()) chunks.push(chunk);
    const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
    let offset = 0;

    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const content = await modelImage(kernel.images, { bytes, mime: file.mime, name });
    cache.set(file.blob, content);
    let size = [...cache.values()].reduce((total, kept) => total + cachedChars(kept), 0);

    for (const [blob, kept] of cache) {
      if (size <= IMAGE_CACHE_CHARS) break;
      cache.delete(blob);
      size -= cachedChars(kept);
    }

    return content.map((part) => ({ ...part }));
  } finally {
    await reader.close();
  }
}

function cachedChars(content: readonly (TextContent | ImageContent)[]): number {
  return content.reduce(
    (total, part) => total + (part.type === "image" ? part.data.length : part.text.length),
    0,
  );
}

async function mentionContent(
  store: StoreConnection,
  mention: { readonly path: string; readonly blob?: BlobId },
): Promise<TextContent> {
  const reader = mention.blob === undefined ? null : await store.objects.blob(mention.blob);

  if (reader === null) return { type: "text", text: `[Reference: ${mention.path}]` };

  try {
    const chunks: Uint8Array[] = [];

    for await (const chunk of reader.chunks()) chunks.push(chunk);
    const decoder = new TextDecoder();
    const contents = chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join("");

    return {
      type: "text",
      text: `<file path="${escapeAttribute(mention.path)}">\n${contents}${decoder.decode()}\n</file>`,
    };
  } finally {
    await reader.close();
  }
}

function excerptAttributes(source: ExcerptSource): string {
  const attribute = (name: string, value: string): string => `${name}="${escapeAttribute(value)}"`;

  switch (source.kind) {
    case "diff": {
      const lines =
        source.start === source.end
          ? String(source.start)
          : `${String(source.start)}-${String(source.end)}`;

      return `source="diff" ${attribute("path", source.path)} side="${source.side}" lines="${lines}"`;
    }

    case "terminal":
      return source.command === undefined
        ? `source="terminal"`
        : `source="terminal" ${attribute("command", source.command)}`;
    case "browser": {
      const page = `source="browser" ${attribute("url", source.url)} ${attribute("selector", source.selector)}`;
      const region = source.region;

      if (region === undefined) return page;

      return `${page} region="x=${String(Math.round(region.x))} y=${String(Math.round(region.y))} w=${String(Math.round(region.width))} h=${String(Math.round(region.height))}"`;
    }
    case "chat":
      return `source="side chat" ${attribute("title", source.title)}`;
    case "design": {
      const file = `source="design" ${attribute("path", source.path)}`;

      return source.frame === null ? file : `${file} ${attribute("frame", source.frame)}`;
    }
  }
}

function fencedExcerpt(text: string): string {
  return text.replaceAll(/<(\s*)\/(\s*excerpt)/gi, String.raw`<$1\/$2`);
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}
