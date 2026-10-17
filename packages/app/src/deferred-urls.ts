/**
 * Each deferred entry's script URL, keyed by entry name. The `deferredChunks`
 * build plugin replaces this module with the emitted chunks' URLs; without the
 * plugin (unit tests, fixture builds) nothing is deferred and every load fails.
 */
const deferredUrls: Readonly<Record<string, string>> = {};

export default deferredUrls;
