import type { BrowserDesignPick } from "../contract/bridge.ts";
import { addToChat, NO_CHAT } from "../references/add-to-chat.ts";

const PNG_DATA_URL = "data:image/png;base64,";

/** Puts what Design Mode picked on a page in the chat composer: its source as an excerpt, and its crop as an image. */
export async function addPickToChat(pick: BrowserDesignPick): Promise<void> {
  const name = pick.source.region === undefined ? "element.png" : "area.png";

  const image =
    pick.image?.startsWith(PNG_DATA_URL) === true
      ? new File([Uint8Array.fromBase64(pick.image.slice(PNG_DATA_URL.length))], name, {
          type: "image/png",
        })
      : undefined;

  const added = await addToChat({
    reference: { kind: "excerpt", source: pick.source, text: pick.text },
    image,
  });

  if (added === false) throw new Error(NO_CHAT);
}
