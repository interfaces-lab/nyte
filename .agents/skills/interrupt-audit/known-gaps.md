# Known gaps

These are real and not fixed. Each names what it would take. The commit that fixes one deletes its entry.

- **A `task` child can reach its parent twice.** A child that ends before its parent's `task` parks the wait has its report delivered and its answer returned by `task`, and a child stopped with its parent reports its stopped end. Holding a child's report until the call that started it settles would cover both.
- **A migration loads the whole store into memory.**
- **Pointer receipts written before the index stopped counting them stay in `pending_work`** until a migration rebuilds the index. They cost a sweep visit each, as before.
- **Search walks the session index when a name is rare.** `sessions.read` with `query` matches a lower-cased name column in activity order until `limit` match, about half a millisecond at 5,000 chats. Pinned chats read from their own index whatever the count. A trigram index would make search independent of the count.
- **A client newer than its host gets `invalid` for a filter the host does not know.** A phone at revision 25 against a Mac at 24 shows no search results and no older pinned chats until the Mac updates.
- **A client cannot tell which session a text frame belongs to.** Every open chat store takes every part streaming on the socket into its text map. A frame for a part its view doesn't hold notifies no one, but its entry stays until the store closes. A session on the frame would let the store drop it.
- **A command outlives a host that was killed.** Its process group is reparented and keeps running while its call reads interrupted and the run resumes, so the model may start it again beside the orphan. Nothing in a client can stop it. Fixing it means storing the pid, group and start time on the job and killing a group whose holder is dead.
- **A killed host's run looks live for 20 s** on the next host, and a Stop in that window shows stopping for as long. The wait is the presence lapse; shortening it for a process on the same machine whose pid is gone means changing the takeover fence.
- **Stop waits for a tool that ignores its abort signal**, and the queue waits behind it. The built-in command and MCP tools honour the signal; a plugin's tool may not.
- **A command over HTTP has no deadline.** A query or a receipt fails after 30 s unanswered, but the host runs some commands for as long as they take, so a Stop sent into a dead path stays pending until the person presses it again.
- **An expired journal entry has no screen.** After a day unsent it is kept and shown as the row a failing send gets, whose text says it is retrying. `unsentSends(...).expired()`, `resend` and the receipt's `stop` are there for a client to offer send and remove.
- **A version mismatch is read from the socket's close reason.** The host closes with 1008 and a sentence, and the client matches its first words. A typed frame before the close needs a revision that both sides can rely on.
- **Mobile cannot answer an approval.** It shows that the run waits.
- **The TUI and mobile keep showing a chat that was deleted elsewhere.** Their head store now goes stale with `unknown`; neither acts on it, and neither reads `archived`.
- **A resume resends the window's order** when nothing moved: 1.6 KB of ids a chat, the largest part of a reconnect.
- **The HTTP stream channel wraps base64 in JSON in SSE.** A frame kind without the inner layers needs a revision bump.
- **A stalled git remote or formatter hangs its call.** `git push`, `blame` and the formatter run have no timeout.
- **A lease's holder notices a lapse up to one renewal late.** With presence the 20 s rule and the process fence cover it; changing it means running the takeover-fence checks.
