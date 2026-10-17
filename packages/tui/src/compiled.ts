/** Whether this runs in the compiled binary, whose modules Bun serves from its virtual filesystem. */
export const compiled =
  import.meta.url.includes("$bunfs") ||
  import.meta.url.includes("~BUN") ||
  import.meta.url.includes("%7EBUN");
