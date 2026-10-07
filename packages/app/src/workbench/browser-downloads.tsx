import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import type { BrowserDownload } from "../bridge.ts";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Spinner } from "@nyte-ai/ui/spinner";
import { glyph } from "@nyte-ai/ui/schema.stylex";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { revealLabel } from "../components/context-menu.ts";
import { nyte } from "../nyte.ts";
import { useHostState } from "../queries.ts";
import { dismissDownload } from "./browser-surfaces.ts";

const styles = create({
  list: {
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondaryTranslucent,
    backgroundColor: role.bgBase,
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    paddingBlock: 4,
    paddingInline: 10,
    color: role.contentSecondary,
    fontSize: type.fontSm,
  },
  glyph: { display: "inline-flex", flexShrink: 0, width: glyph.sm, justifyContent: "center" },
  name: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: role.contentPrimary,
  },
  detail: {
    flexShrink: 0,
    fontVariantNumeric: "tabular-nums",
  },
  failed: { color: role.contentDisabled },
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value < 10 ? value.toFixed(1) : String(Math.round(value))} ${units[unit] ?? "GB"}`;
}

function detail(download: BrowserDownload): string {
  switch (download.state) {
    case "progressing":
      return download.total > 0
        ? `${formatBytes(download.received)} of ${formatBytes(download.total)}`
        : formatBytes(download.received);
    case "completed":
      return formatBytes(download.received);
    case "cancelled":
      return "Cancelled";
    case "interrupted":
      return "Failed";
    default: {
      const _exhaustive: never = download.state;

      return _exhaustive;
    }
  }
}

interface DownloadsBarProps {
  readonly surface: string;
  readonly downloads: readonly BrowserDownload[];
}

export function DownloadsBar({ surface, downloads }: DownloadsBarProps): ReactElement | null {
  const host = useHostState();

  if (downloads.length === 0) return null;
  const revealPath = nyte.host.revealPath;

  return (
    <div role="status" aria-label="Downloads" {...props(styles.list)}>
      {downloads.map((download) => {
        const running = download.state === "progressing";
        const done = download.state === "completed";

        return (
          <div key={download.id} {...props(styles.item)}>
            <span {...props(styles.glyph)}>
              {running ? <Spinner /> : <Icon name={done ? "checkmark" : "x"} size={12} />}
            </span>
            <span {...props(styles.name, !running && !done && styles.failed)} title={download.path}>
              {download.filename}
            </span>
            <span {...props(styles.detail)}>{detail(download)}</span>
            {running && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void nyte.host.browser
                    ?.cancelDownload({ surface, id: download.id })
                    .catch(() => undefined);
                }}
              >
                Cancel
              </Button>
            )}
            {done && revealPath !== undefined && (
              <Button
                iconOnly
                icon="folder-open"
                size="sm"
                aria-label={revealLabel(host.data?.platform)}
                onClick={() => void revealPath({ path: download.path }).catch(() => undefined)}
              />
            )}
            {!running && (
              <Button
                iconOnly
                icon="x"
                size="sm"
                aria-label={`Dismiss ${download.filename}`}
                onClick={() => dismissDownload(surface, download.id)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
