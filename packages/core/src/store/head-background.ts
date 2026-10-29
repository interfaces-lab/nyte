import { isJsonObject } from "@nyte-ai/schema";
import { Value } from "typebox/value";
import type { RewriteStep } from "./migrations.ts";

/** Head rows count background work; a logged `session` event's rows count none. */
export const headBackground: RewriteStep = {
  kind: "rewrite",
  name: "2026-10-29-head-background",
  rewriteLog: (events) =>
    events.map((event) => {
      if (!isJsonObject(event) || event.kind !== "session" || !isJsonObject(event.info))
        return null;
      const heads = Array.isArray(event.info.heads) ? event.info.heads : [];

      const counted = heads.map((head) =>
        isJsonObject(head) && !("background" in head)
          ? { ...head, background: { working: 0, waiting: 0 } }
          : head,
      );

      return Value.Equal(counted, heads)
        ? null
        : { ...event, info: { ...event.info, heads: counted } };
    }),
};
