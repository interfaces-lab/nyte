---
"@nyte-ai/schema": patch
"@nyte-ai/ai": patch
"@nyte-ai/core": patch
"@nyte-ai/plugin": patch
"@nyte-ai/protocol": patch
"@nyte-ai/host": patch
"@nyte-ai/sdk": patch
"nyte-ai": patch
"@nyte-ai/tui": patch
"@nyte-ai/desktop": patch
---

Processes share one store without an owner lock: `nyte` and Nyte.app open the same chats at once, a process that stops beating is judged dead only while this process's own beats land, and a run, timer or job that a dead process held is taken over by a live one. Chats that source runs create live in `nyte-dev.db`.

The desktop app streams faster and holds less memory:

- A streamed token re-renders one transcript row instead of the whole conversation, code blocks highlight once they close, and text streams in by word.
- Each pane keeps its three most recent chats mounted, so switching back is instant, and hovering a chat starts its live stream before the click.
- A chat's history leaves memory when nothing watches it.
- Typing writes one draft after a pause instead of every draft on each keystroke, and pressed buttons react at once.

`@nyte-ai/sdk`: `pagedViews` reuses its merged arrays when a frame keeps the same messages and turns.
