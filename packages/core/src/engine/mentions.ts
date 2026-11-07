import type { SessionId, UserContent } from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";

const MENTION_CHARS = 100_000;

export async function freezeMentions(
  kernel: Kernel,
  session: SessionId,
  content: UserContent,
): Promise<UserContent> {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- UserContent is text or parts; Array.isArray would widen the parts to any[]
  if (typeof content === "string" || !content.some((item) => item.kind === "reference"))
    return content;
  const env = await kernel.environments.attach(session).catch(() => null);

  return Promise.all(
    content.map(async (item) => {
      if (item.kind !== "reference") return item;
      const mention = { kind: "reference" as const, path: item.path };
      const document = await env?.files.read(item.path).catch(() => null);

      if (document?.kind !== "text" || document.contents.length > MENTION_CHARS) return mention;

      return { ...mention, blob: await kernel.store.objects.putBlob(once(document.contents)) };
    }),
  );
}

async function* once(text: string): AsyncIterable<Uint8Array> {
  yield new TextEncoder().encode(text);
}
