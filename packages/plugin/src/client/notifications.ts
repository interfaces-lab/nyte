import type { Plugin } from "@nyte-ai/plugin/client";
import type { SessionId } from "@nyte-ai/schema";
import { alertNews, headAttention, sessionTitle } from "./presentation.ts";

/**
 * Tells the user what the desktop's alerts tell them, for a session this client can see but nobody
 * is looking at: that it waits on their answer, finished, or failed with the reason. It reads the
 * same `headAttention` alert the desktop does, so a stopped run stays quiet because someone asked
 * for it, and so do sessions a parent spawned, so a delegation does not ring once per child; a
 * subagent's question rings on its parent, which asks for it, and an answered one does not ring
 * its parent's end again.
 *
 * @category plugins
 * @since 0.1.0
 */
export default {
  id: "notifications",
  activate(api) {
    const heard = new Map<SessionId, string>();

    api.hook("attention_changed_anywhere", (event) => {
      const info = event.info;
      const alert = headAttention(info).alert;
      const news = alertNews(heard.get(info.id), alert);
      heard.set(info.id, alert.key);

      if (!news || alert.state === undefined || info.parent !== null || api.looking.has(info.id))
        return;
      api.ui.notify({
        title: sessionTitle(info),
        message: alert.body,
        level: alert.state === "failed" ? "error" : alert.state === "waiting" ? "warning" : "info",
      });
    });
  },
} satisfies Plugin;
