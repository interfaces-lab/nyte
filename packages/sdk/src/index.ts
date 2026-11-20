import { openHost } from "@nyte-ai/host/open";
import { connect } from "./connection/connect.ts";

export type { OpenHostOptions } from "@nyte-ai/host";
export { createSendJournal } from "./send/journal.ts";

export type { JournalStorage } from "./send/journal.ts";

export { languageDocument } from "./view/language-document.ts";

export type { LanguageDocument } from "./view/language-document.ts";

export * from "./surface.ts";

export const sdk = { open: openHost, connect };
