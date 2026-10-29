import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import type { GitHubCheck, GitHubPullRequest } from "@nyte-ai/sdk";
import { ButtonLink } from "@nyte-ai/ui/button";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { Icon } from "@nyte-ai/ui/icon";
import type { IconName } from "@nyte-ai/ui/icon";
import { focus } from "@nyte-ai/ui/styles/a11y.stylex";
import { button, glyph, radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";

type CheckState = GitHubCheck["state"];

const SUMMARY_ORDER: readonly CheckState[] = ["failed", "pending", "passed", "skipped"];

const CHECK_LABELS = {
  failed: "failing",
  pending: "pending",
  passed: "passed",
  skipped: "skipped",
} as const satisfies Record<CheckState, string>;

const CHECK_GLYPHS = {
  failed: { icon: "circle-x", tone: intent.danger, label: "Failed" },
  pending: { icon: "clock", tone: intent.warning, label: "Pending" },
  passed: { icon: "checkmark", tone: intent.success, label: "Passed" },
  skipped: { icon: "arrow-right", tone: null, label: "Skipped" },
} as const satisfies Record<
  CheckState,
  {
    readonly icon: IconName;
    readonly tone: (typeof intent)[keyof typeof intent] | null;
    readonly label: string;
  }
>;

function pullRequestIcon(pullRequest: GitHubPullRequest): IconName {
  switch (pullRequest.state) {
    case "OPEN":
      return pullRequest.draft ? "draft" : "pull-request";
    case "MERGED":
      return "merged";
    case "CLOSED":
      return "pull-request-closed";
  }
}

function pullRequestState(pullRequest: GitHubPullRequest): string {
  switch (pullRequest.state) {
    case "OPEN":
      return pullRequest.draft ? "Draft" : "Open";
    case "MERGED":
      return "Merged";
    case "CLOSED":
      return "Closed";
  }
}

export function checksSummary(checks: readonly GitHubCheck[]): string {
  if (checks.length === 0) return "No checks";

  if (checks.every((check) => check.state === "passed"))
    return checks.length === 1 ? "1 check passed" : `All ${String(checks.length)} checks passed`;

  return SUMMARY_ORDER.flatMap((state) => {
    const count = checks.filter((check) => check.state === state).length;

    return count === 0 ? [] : [`${String(count)} ${CHECK_LABELS[state]}`];
  }).join(", ");
}

function rollupState(checks: readonly GitHubCheck[]): CheckState {
  return SUMMARY_ORDER.find((state) => checks.some((check) => check.state === state)) ?? "skipped";
}

const styles = create({
  root: { display: "flex", flexDirection: "column", gap: space.s0_5, minWidth: 0 },
  header: { display: "flex", alignItems: "center", gap: space.s1_5, minWidth: 0 },
  glyph: {
    display: "inline-flex",
    flexShrink: 0,
    justifyContent: "center",
    width: glyph.box,
    color: role.contentSecondary,
  },
  title: { flexShrink: 1, minWidth: 0 },
  titleText: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  meta: { flexShrink: 0, color: role.contentTertiary },
  trigger: {
    display: "flex",
    alignItems: "center",
    gap: space.s1_5,
    minWidth: 0,
    paddingBlock: space.s0_5,
    borderRadius: radius.control,
    color: role.contentSecondary,
    textAlign: "start",
  },
  summary: { flexGrow: 1, minWidth: 0 },
  chevron: { color: role.contentTertiary },
  checks: {
    display: "flex",
    flexDirection: "column",
    margin: 0,
    paddingBlock: 0,
    paddingInlineStart: space.s5,
    listStyle: "none",
  },
  check: {
    display: "flex",
    alignItems: "center",
    gap: button.gapXs,
    minWidth: 0,
    minHeight: button.heightSm,
  },
  checkName: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
});

function CheckGlyph({ state }: { readonly state: CheckState }): ReactElement {
  const glyph = CHECK_GLYPHS[state];

  return (
    <span {...props(glyph.tone, styles.glyph)}>
      <Icon name={glyph.icon} size={12} label={glyph.label} />
    </span>
  );
}

function Check({
  check,
  onOpenLink,
}: {
  readonly check: GitHubCheck;
  readonly onOpenLink: (url: string) => void;
}): ReactElement {
  const { url } = check;

  const content = (
    <>
      <CheckGlyph state={check.state} />
      <span {...props(styles.checkName)}>{check.name}</span>
    </>
  );

  return (
    <li {...props(text.sm, styles.check)}>
      {url === undefined ? (
        content
      ) : (
        <ButtonLink
          href={url}
          target="_blank"
          rel="noreferrer"
          variant="text"
          size="xs"
          onClick={(event) => {
            event.preventDefault();
            onOpenLink(url);
          }}
        >
          {content}
        </ButtonLink>
      )}
    </li>
  );
}

export function ChangesPullRequest({
  pullRequest,
  onOpenLink,
}: {
  readonly pullRequest: GitHubPullRequest;
  readonly onOpenLink: (url: string) => void;
}): ReactElement {
  const { checks } = pullRequest;
  const summary = checksSummary(checks);

  return (
    <section aria-label="Pull request" {...props(styles.root)}>
      <div {...props(text.sm, styles.header)}>
        <span {...props(styles.glyph)}>
          <Icon name={pullRequestIcon(pullRequest)} size={14} />
        </span>
        <ButtonLink
          href={pullRequest.url}
          target="_blank"
          rel="noreferrer"
          variant="text"
          size="xs"
          title={pullRequest.title}
          xstyle={styles.title}
          onClick={(event) => {
            event.preventDefault();
            onOpenLink(pullRequest.url);
          }}
        >
          <span {...props(styles.titleText)}>
            #{String(pullRequest.number)} {pullRequest.title}
          </span>
        </ButtonLink>
        <span {...props(text.xs, styles.meta)}>{pullRequestState(pullRequest)}</span>
      </div>
      {checks.length === 0 ? (
        <span {...props(text.sm, styles.trigger)}>{summary}</span>
      ) : (
        <Collapsible.Root>
          <Collapsible.Trigger variant="plain" xstyle={[text.sm, styles.trigger, focus.ringInset]}>
            <CheckGlyph state={rollupState(checks)} />
            <span {...props(styles.summary)}>{summary}</span>
            <Collapsible.Chevron xstyle={styles.chevron} />
          </Collapsible.Trigger>
          <Collapsible.Panel hiddenUntilFound={false}>
            <ul aria-label="Checks" {...props(styles.checks)}>
              {checks.map((check, index) => (
                <Check
                  key={`${check.name}\u0000${String(index)}`}
                  check={check}
                  onOpenLink={onOpenLink}
                />
              ))}
            </ul>
          </Collapsible.Panel>
        </Collapsible.Root>
      )}
    </section>
  );
}
