/**
 * The workspace entries a composer offers behind `@`. Hosts walk the tree;
 * clients only filter and display, so the walk lives here where the TUI and
 * the desktop main process both reach it.
 */
import { readFile, readdir } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import ignorePackage, { type Ignore, type Options } from "ignore";

const MAX_MENTION_FILES = 5_000;

type IgnoreFactory = (options?: Options) => Ignore;

// CommonJS default types differ between NodeNext and Bundler consumers.
function resolveIgnoreFactory(
  source: IgnoreFactory | { readonly default: IgnoreFactory },
): IgnoreFactory {
  return "default" in source ? source.default : source;
}

const createIgnore = resolveIgnoreFactory(ignorePackage);

interface IgnoreScope {
  readonly directory: string;
  readonly matcher: Ignore;
}

export interface MentionFile {
  /** Absolute path. Directories carry a trailing separator. */
  readonly path: string;
  /** The `file:` URL a message spells the mention as (`@file:///…`). */
  readonly url: string;
  /** Path relative to the workspace root, forward slashes, `/` suffix for directories. */
  readonly displayPath: string;
  /** Basename, `/` suffix for directories. */
  readonly label: string;
}

/** Files and folders offered by `@`, respecting workspace .gitignore files.
 * Git metadata and symlinks are excluded; ignored directories are never traversed.
 */
export async function discoverMentionFiles(cwd: string): Promise<MentionFile[]> {
  const root = resolve(cwd);
  const files: MentionFile[] = [];
  const pending: { directory: string; scopes: readonly IgnoreScope[] }[] = [
    { directory: root, scopes: [] },
  ];
  while (pending.length > 0 && files.length < MAX_MENTION_FILES) {
    const current = pending.pop();
    if (current === undefined) break;
    const entries = await readdir(current.directory, { withFileTypes: true }).catch(() => []);
    const scopes = [...current.scopes];
    // Git does not follow symlinked .gitignore files.
    if (entries.some((entry) => entry.name === ".gitignore" && entry.isFile())) {
      const patterns = await readFile(join(current.directory, ".gitignore"), "utf8").catch(
        () => "",
      );
      scopes.push({
        directory: current.directory,
        matcher: createIgnore({ ignorecase: false }).add(patterns),
      });
    }
    for (const entry of entries) {
      if (files.length >= MAX_MENTION_FILES) break;
      if (entry.name === ".git" || (!entry.isDirectory() && !entry.isFile())) continue;
      const path = join(current.directory, entry.name);
      let ignored = false;
      for (const scope of scopes) {
        const result = scope.matcher.test(
          relative(scope.directory, path).split(sep).join("/") + (entry.isDirectory() ? "/" : ""),
        );
        // Deeper rules override ancestors only when they explicitly match.
        if (result.ignored || result.unignored) ignored = result.ignored;
      }
      // A negation cannot restore a file beneath an excluded parent directory.
      if (ignored) continue;
      const displayPath = relative(root, path).split(sep).join("/");
      if (entry.isDirectory()) {
        pending.push({ directory: path, scopes });
        files.push({
          path: path + sep,
          url: pathToFileURL(path).href,
          displayPath: `${displayPath}/`,
          label: `${entry.name}/`,
        });
        continue;
      }
      files.push({ path, url: pathToFileURL(path).href, displayPath, label: basename(path) });
    }
  }
  return files.toSorted((left, right) => left.displayPath.localeCompare(right.displayPath));
}
