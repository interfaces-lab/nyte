/** Shortest unique tail so two `styles.ts` files still read as different paths. */
export function fileListLabel(path: string, peers: readonly string[]): string {
  const parts = path.split("/").filter((part) => part !== "");

  if (parts.length === 0) return path;

  for (let take = 1; take <= parts.length; take += 1) {
    const tail = parts.slice(-take).join("/");

    const unique = peers.every((peer) => {
      if (peer === path) return true;
      const other = peer.split("/").filter((part) => part !== "");

      return other.slice(-take).join("/") !== tail;
    });

    if (unique) return tail;
  }

  return path;
}
