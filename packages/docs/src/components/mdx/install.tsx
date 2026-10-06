import { docsIcons, isDocsIconName } from "~/lib/docs-icons";
import { latestMacRelease, releasesUrl } from "~/lib/releases";

/* An icon set inline before a heading's text, sized to the heading. */
export function PlatformIcon({ name }: { name: string }) {
  if (!isDocsIconName(name)) throw new Error(`Unknown docs icon: ${name}`);
  const Icon = docsIcons[name];
  return (
    <span aria-hidden="true" className="doc-platform-icon">
      <Icon size="1.2em" />
    </span>
  );
}

/* The desktop app card: icon, name, the latest version, and one action. */
export async function DesktopDownload() {
  const release = await latestMacRelease();

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
