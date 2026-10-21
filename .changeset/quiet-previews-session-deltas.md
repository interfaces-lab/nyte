---
"@nyte-ai/schema": patch
"@nyte-ai/core": patch
"@nyte-ai/protocol": patch
"@nyte-ai/host": patch
"@nyte-ai/sdk": patch
"@nyte-ai/ios": patch
---

Skills whose `description` is a folded or literal YAML block (`>` or `|`) now show their text instead of the symbol, and skill directories that are symlinks are discovered; links that are broken, point at a file or loop are skipped, and two links to one directory load it once. A running command's preview now updates at most every 80 ms while output streams, instead of on every chunk, and still shows the first output and the final tail at once. The session list sends only the rows that changed after its first frame, so `sessions.watch` on the wire is now a frame that clients read through the SDK. The iOS inbox's relative times stop updating while the inbox is hidden or the app is in the background, and refresh as soon as you return.
