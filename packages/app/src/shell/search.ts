/** The search every route shares: which chrome page and Usage view the window shows. */
export interface ShellSearch {
  readonly customize?: string;
  readonly environment?: string;
  readonly usage?: string;
  readonly usageRange?: string;
}
