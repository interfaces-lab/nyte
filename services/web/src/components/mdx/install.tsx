import { docsIcons, hasDocsIcon } from "~/lib/docs-icons";
import { releasesUrl } from "~/lib/releases";
import { useMacRelease } from "~/lib/site-data";

export function PlatformIcon({ name }: { name: string }) {
  if (!hasDocsIcon(name)) throw new Error(`Unknown docs icon: ${name}`);
  const Icon = docsIcons[name];
  return (
    <span aria-hidden="true" className="doc-platform-icon">
      <Icon size="1.2em" />
    </span>
  );
}

export function DesktopDownload() {
  const release = useMacRelease();

  return (
    <div className="doc-download">
      <img src="/app-icon.png" alt="" width={64} height={64} />
      <div className="doc-download-text">
        <span>Nyte for macOS</span>
        <span>{release ? `${release.version} · Apple Silicon` : "Apple Silicon"}</span>
      </div>
      <a href={release?.downloadUrl ?? `${releasesUrl}/latest`}>Download</a>
    </div>
  );
}
