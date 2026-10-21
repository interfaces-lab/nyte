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

Closing a host waits for its MCP servers to exit, and an MCP server's tool-call timeout no longer cuts its startup short. Shutting down a driver no longer leaves a turn running that nothing can stop. When a lease drops only devices this host already refused, other devices' requests keep going. Closing a host under Bun releases its database files at once, so Windows can delete them. On Windows, an `@` mention of a file reads as the file's name in the composer.
