import { findExecutable } from "../process/command.ts";
import { openProject, passesProbe } from "../language/install.ts";
import type { Installer } from "../language/install.ts";
import type { Asset, Install } from "../language/spec.ts";

const VERSION = "15.1.0";

const PROBE = ["--version"];

function asset(target: string, sha256: string): Asset {
  const windows = target.endsWith("windows-msvc");
  const folder = `ripgrep-${VERSION}-${target}`;

  return {
    url: `https://github.com/BurntSushi/ripgrep/releases/download/${VERSION}/${folder}.${windows ? "zip" : "tar.gz"}`,
    sha256,
    format: windows ? "zip" : "tar.gz",
    bin: `${folder}/${windows ? "rg.exe" : "rg"}`,
  };
}

export const RIPGREP: Install = {
  kind: "release",
  package: "ripgrep",
  version: VERSION,
  assets: {
    "darwin-arm64": asset(
      "aarch64-apple-darwin",
      "378e973289176ca0c6054054ee7f631a065874a352bf43f0fa60ef079b6ba715",
    ),
    "darwin-x64": asset(
      "x86_64-apple-darwin",
      "64811cb24e77cac3057d6c40b63ac9becf9082eedd54ca411b475b755d334882",
    ),
    "linux-arm64": asset(
      "aarch64-unknown-linux-gnu",
      "2b661c6ef508e902f388e9098d9c4c5aca72c87b55922d94abdba830b4dc885e",
    ),
    "linux-x64": asset(
      "x86_64-unknown-linux-musl",
      "1c9297be4a084eea7ecaedf93eb03d058d6faae29bbc57ecdaf5063921491599",
    ),
    "win32-arm64": asset(
      "aarch64-pc-windows-msvc",
      "00d931fb5237c9696ca49308818edb76d8eb6fc132761cb2a1bd616b2df02f8e",
    ),
    "win32-x64": asset(
      "x86_64-pc-windows-msvc",
      "124510b94b6baa3380d051fdf4650eaa80a302c876d611e9dba0b2e18d87493a",
    ),
  },
};

/** Finds the ripgrep to run: `pinned` when given, else the one on `PATH` when it answers `--version`, else the pinned download. A miss is asked again next time, so a download that failed offline is retried. */
export function ripgrepFinder(options: {
  readonly pinned: string | undefined;
  readonly installer: Installer;
  readonly cwd: string;
}): () => Promise<string | null> {
  const { pinned, installer, cwd } = options;

  if (pinned !== undefined) return () => findExecutable(pinned);
  let found: Promise<string | null> | null = null;

  return () => {
    found ??= openProject(cwd, installer)
      .tool("rg", PROBE, RIPGREP)
      .then(async (tool) =>
        tool === null || (tool.pinned && !(await passesProbe(tool.path, PROBE, cwd)))
          ? null
          : tool.path,
      );
    const finding = found;
    void finding.then((path) => {
      if (path === null && found === finding) found = null;
    });

    return finding;
  };
}
