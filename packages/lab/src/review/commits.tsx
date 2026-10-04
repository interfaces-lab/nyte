/**
 * The commits under review, newest first. Each opens its own changes in the
 * Changes tab, so a long branch can be read one commit at a time.
 */
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { radius, row } from "@nyte-ai/ui/schema.stylex";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { when } from "./files";
import type { Commit } from "./wire";

export function CommitList({
  commits,
  onOpen,
}: {
  readonly commits: readonly Commit[];
  readonly onOpen: (oid: string) => void;
}): ReactElement {
  return (
    <div {...props(styles.scroll)}>
      <ol aria-label="Commits" {...props(styles.list)}>
        {commits.map((commit) => (
          <li key={commit.oid} {...props(styles.row)}>
            <div {...props(styles.body)}>
              <span {...props(styles.subject)}>{commit.subject}</span>
              <span {...props(styles.meta)}>
                <span translate="no" {...props(styles.sha)}>
                  {commit.short}
                </span>
                <span aria-hidden="true">·</span>
                <span>{commit.author}</span>
                <span aria-hidden="true">·</span>
                <time dateTime={new Date(commit.at).toISOString()}>{when(commit.at)}</time>
              </span>
            </div>
            <Button variant="outline" onClick={() => onOpen(commit.oid)}>
              View changes
            </Button>
          </li>
        ))}
      </ol>
    </div>
  );
}

const styles = create({
  scroll: { flex: 1, minHeight: 0, overflowY: "auto", paddingInline: 16, paddingBlock: "4px 96px" },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    minHeight: row.heightLg,
    paddingBlock: 10,
    paddingInline: 12,
    borderRadius: radius.control,
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover) and (pointer: fine)": role.bgHover },
    },
  },
  body: { display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 },
  subject: {
    color: role.contentPrimary,
    fontSize: type.fontBase,
    fontWeight: 500,
    overflowWrap: "anywhere",
  },
  meta: {
    display: "flex",
    flexWrap: "wrap",
    columnGap: 6,
    color: role.contentSecondary,
    fontSize: type.fontSm,
  },
  sha: { fontFamily: type.fontMono, fontSize: type.fontXs, fontVariantNumeric: "tabular-nums" },
});
