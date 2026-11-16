import type { Plugin } from "@nyte-ai/plugin/client";
import type { SessionId } from "@nyte-ai/schema";
import { alertsOnChat } from "./alerts.ts";
import { alertNews, headAttention, sessionTitle } from "./presentation.ts";

export default {
  id: "notifications",
  activate(api) {
    const heard = new Map<SessionId, string>();

    api.hook("attention_changed_anywhere", (event) => {
      const info = event.info;
      const alert = headAttention(info).alert;
      const news = alertNews(heard.get(info.id), alert);
      heard.set(info.id, alert.key);

      if (
        !news ||
        alert.state === undefined ||
        !alertsOnChat(info, alert, true, false) ||
        api.looking.has(info.id)
      )
        return;
      api.ui.notify({
        title: sessionTitle(info),
        message: alert.body,
        level: alert.state === "failed" ? "error" : alert.state === "waiting" ? "warning" : "info",
      });
    });
  },
} satisfies Plugin;
