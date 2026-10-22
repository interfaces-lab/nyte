---
"@nyte-ai/desktop": patch
"@nyte-ai/tui": patch
"nyte-ai": patch
---

The chat stays at its newest message while a reply streams, and stays put while you read: a clicked toggle, an open message editor or a text selection no longer jumps away when rows above them resize. The Files Changed footer keeps one height, Review opens the Changes tab, and Escape cancels a message edit.

Nightly builds and update channels: switch an installation to nightly updates, and back to stable with `nyte update <version>`. Remote hosts outside development require HTTPS.

Breaking: `nyte serve` and the desktop's This Mac only remote access option are removed.
