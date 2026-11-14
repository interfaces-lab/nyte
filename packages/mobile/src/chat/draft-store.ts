import { createMMKV } from "react-native-mmkv";

/** The chat drafts this phone keeps, read by the composer and written back when a replayed send is refused. */
export const chatDrafts = createMMKV({ id: "nyte.drafts" });
