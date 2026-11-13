import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { fetchParameters, searchOutput, searchParameters } from "@nyte-ai/plugin/web/schema";
import { toolStatus } from "@nyte-ai/plugin/client/presentation";
import type { ToolMessage } from "@nyte-ai/plugin/client/presentation";
import { Icon } from "@nyte-ai/ui/icon";
import { focus } from "@nyte-ai/ui/styles/a11y.stylex";
import { media, radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { useReferenceOpener } from "../../references/reference-opener.tsx";
import { ToolMark, ToolSpinner, ToolVerb, toolCardStyles } from "./tool-card.tsx";
import { ToolOutcome } from "./tool-line.tsx";

const SHOWN_SOURCES = 4;

const styles = create({
  sources: { display: "flex", flexWrap: "wrap", gap: space.s1, paddingBlockEnd: space.s1 },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s1,
    maxWidth: "100%",
    minWidth: 0,
    paddingBlock: space.s0_5,
    paddingInlineStart: space.s1_5,
    paddingInlineEnd: space.s2,
    borderRadius: radius.pill,
    color: { default: role.contentSecondary, ":hover": { [media.hover]: role.contentPrimary } },
    backgroundColor: {
      default: role.fillTertiary,
      ":hover": { [media.hover]: role.fillSecondary },
    },
    textDecoration: "none",
    whiteSpace: "nowrap",
  },
  chipText: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
  chipMuted: { color: role.contentTertiary },
  more: { alignSelf: "center", color: role.contentTertiary },
});

function site(url: URL): string {
  return url.hostname.replace(/^www\./u, "");
}

export function SearchCallView({ message }: { readonly message: ToolMessage }): ReactElement {
  const status = toolStatus(message);
  const running = status.tense === "running";
  const args = searchParameters["~standard"].validate(message.state.args);
  const query = args instanceof Promise || args.issues !== undefined ? "" : args.value.query;
  const state = message.state;

  const output =
    state.phase === "settled" && state.outcome.kind === "ok"
      ? searchOutput["~standard"].validate(state.outcome.output)
      : undefined;

  const sources =
    output === undefined || output instanceof Promise || output.issues !== undefined
      ? []
      : output.value.results.flatMap((result) => {
          const url = URL.parse(result.url);

          return url === null ? [] : [{ url, title: result.title }];
        });

  return (
    <div {...props(toolCardStyles.stack)}>
      <div {...props(toolCardStyles.line)}>
        {running ? (
          <ToolSpinner />
        ) : (
          <span aria-hidden="true" {...props(toolCardStyles.glyph)}>
            <Icon name="search" size="sm" />
          </span>
        )}
        <ToolVerb running={running}>{running ? "Searching web" : "Searched web"}</ToolVerb>
        <span {...props(toolCardStyles.muted)}>{query}</span>
        <ToolOutcome status={status} />
      </div>
      {sources.length > 0 && (
        <div {...props(styles.sources, toolCardStyles.hang)}>
          {sources.slice(0, SHOWN_SOURCES).map((source) => (
            <SiteChip key={source.url.href} url={source.url} title={source.title} />
          ))}
          {sources.length > SHOWN_SOURCES && (
            <span {...props(text.sm, styles.more)}>+{sources.length - SHOWN_SOURCES} more</span>
          )}
        </div>
      )}
    </div>
  );
}

export function FetchCallView({ message }: { readonly message: ToolMessage }): ReactElement {
  const status = toolStatus(message);
  const running = status.tense === "running";
  const args = fetchParameters["~standard"].validate(message.state.args);

  const url =
    args instanceof Promise || args.issues !== undefined ? null : URL.parse(args.value.url);

  return (
    <div {...props(toolCardStyles.line)}>
      {running ? (
        <ToolSpinner />
      ) : (
        <span aria-hidden="true" {...props(toolCardStyles.glyph)}>
          <Icon name="globe" size="sm" />
        </span>
      )}
      <ToolVerb running={running}>{running ? "Reading" : "Read"}</ToolVerb>
      {url !== null && <SiteChip url={url} path />}
      <ToolOutcome status={status} />
    </div>
  );
}

function SiteChip({
  url,
  title,
  path = false,
}: {
  readonly url: URL;
  readonly title?: string;
  readonly path?: boolean;
}): ReactElement {
  const opener = useReferenceOpener();
  const open = opener?.({ kind: "url", url: url.href });

  return (
    <a
      href={url.href}
      title={title ?? url.href}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => {
        if (open === undefined) return;
        event.preventDefault();
        open();
      }}
      {...props(text.sm, styles.chip, focus.ring)}
    >
      <ToolMark name={site(url)} fallback="globe" small />
      <span {...props(styles.chipText)}>{site(url)}</span>
      {path && (
        <span {...props(styles.chipText, styles.chipMuted)}>
          {url.pathname === "/" ? "" : url.pathname}
        </span>
      )}
    </a>
  );
}
