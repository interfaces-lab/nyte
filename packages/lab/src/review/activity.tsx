/**
 * Where the review stands and how it got there. First the branch and Nyte,
 * then one line for what the review is waiting on, then every event in order:
 * the task, each push, each guide, each question and change request, each
 * approval. All of it is read back from core and git, none of it is scripted.
 */
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import type { UserTurnPart } from "@nyte-ai/protocol";
import { StatusDot } from "@nyte-ai/app/components/ui.tsx";
import { Icon, type IconName } from "@nyte-ai/ui/icon";
import { Row } from "@nyte-ai/ui/row";
import { Spinner } from "@nyte-ai/ui/spinner";
import { intent } from "@nyte-ai/ui/surface-theme";
import { role } from "@nyte-ai/ui/vars.stylex";
import type { ChatTurn } from "./api";
import { plural, when } from "./files";
import type { ReviewDetail } from "./wire";

interface Entry {
  readonly at: number;
  readonly icon: IconName;
  readonly title: string;
  readonly detail: string | undefined;
}

/** A message's first line, the way a timeline quotes it. */
function firstLine(content: UserTurnPart["content"]): string {
  const text = Array.isArray(content)
    ? content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(" ")
    : content;

  return text.trim().split("\n")[0] ?? "";
}

const short = (oid: string): string => oid.slice(0, 7);

function entries(review: ReviewDetail, turns: readonly ChatTurn[]): readonly Entry[] {
  const subject = (oid: string): string | undefined =>
    review.commits.find((commit) => commit.oid === oid)?.subject;

  const found: Entry[] = [
    review.task === undefined
      ? {
          at: review.createdAt,
          icon: "pull-request",
          title: "Review opened",
          detail: review.headRef,
        }
      : {
          at: review.createdAt,
          icon: "agent",
          title: "You gave Nyte a task",
          detail: review.task.split("\n")[0],
        },
  ];

  for (const revision of review.revisions) {
    if (revision.head === revision.base) continue;

    found.push({
      at: revision.at,
      icon: "git",
      title: `Branch at ${short(revision.head)}`,
      detail: subject(revision.head),
    });
  }

  for (const brief of review.briefs) {
    if (brief.doneAt === undefined || brief.status !== "done") continue;

    found.push({
      at: brief.doneAt,
      icon: "file-text",
      title:
        brief.from === undefined
          ? `Guide written for ${short(brief.head)}`
          : `Guide updated for ${short(brief.head)}`,
      detail:
        brief.from === undefined ? undefined : `From the interdiff since ${short(brief.from)}`,
    });
  }

  // The task is the first thing Nyte's session hears; it is already on the timeline.
  for (const { turn, source } of turns.slice(review.task === undefined ? 0 : 1)) {
    const asked = turn.parts.find((part) => part.kind === "user");

    if (asked?.kind !== "user") continue;

    found.push({
      at: turn.startedAt,
      icon: source === "nyte" ? "pencil" : "bubble-question",
      title: source === "nyte" ? "You asked Nyte for a change" : "You asked the reviewer",
      detail: firstLine(asked.content),
    });
  }

  for (const approval of review.approvals)
    found.push({
      at: approval.at,
      icon: "checkmark",
      title: `You approved ${short(approval.head)}`,
      detail: undefined,
    });

  return found.toSorted((left, right) => left.at - right.at);
}

/** What the review is waiting on, in one line. */
interface Standing {
  readonly mark: "working" | "done" | "failed";
  readonly label: string;
  readonly detail: string;
}

function standing(review: ReviewDetail): Standing {
  const brief = review.briefs.find((entry) => entry.head === review.revision.head);
  const empty = review.revision.head === review.revision.base;
  const approved = review.approvals.at(-1)?.head === review.revision.head;
  const onBase = plural(review.commits.length, "commit", "commits");

  if (review.author?.status === "working")
    return {
      mark: "working",
      label: empty ? "Nyte is working on the task" : "Nyte is changing the branch",
      detail: review.author.worktree,
    };

  if (empty) return { mark: "working", label: "No commits yet", detail: review.headRef };

  if (review.author?.status === "failed")
    return { mark: "failed", label: "Nyte stopped", detail: review.author.failure ?? "" };

  if (brief === undefined || brief.status === "running")
    return { mark: "working", label: "Writing the guide", detail: onBase };

  if (brief.status === "failed")
    return { mark: "failed", label: "The guide failed", detail: brief.failure ?? "" };

  return approved
    ? { mark: "done", label: "Approved", detail: `${short(review.revision.head)} · ${onBase}` }
    : { mark: "done", label: "Waiting for your review", detail: onBase };
}

export function ActivityTab({
  review,
  turns,
}: {
  readonly review: ReviewDetail;
  readonly turns: readonly ChatTurn[];
}): ReactElement {
  const state = standing(review);

  return (
    <div {...props(styles.scroll)}>
      <div {...props(styles.column)}>
        <div {...props(styles.group)}>
          <Row>
            <Row.Leading>
              <Icon name="git-branch" size={14} />
            </Row.Leading>
            <Row.Label>
              <span translate="no">
                {review.headRef} → {review.baseRef}
              </span>
            </Row.Label>
            <Row.Meta>{plural(review.commits.length, "commit", "commits")}</Row.Meta>
          </Row>
          {review.author !== undefined && (
            <Row>
              <Row.Leading>
                <Icon name="agent" size={14} />
              </Row.Leading>
              <Row.Label>Nyte</Row.Label>
              <Row.Meta>
                <span title={review.author.worktree}>
                  {review.author.status === "working" ? "Working" : "In its own worktree"}
                </span>
              </Row.Meta>
            </Row>
          )}
        </div>
        <div {...props(styles.group)}>
          <Row size="lg">
            <Row.Leading>
              {state.mark === "working" ? (
                <Spinner />
              ) : state.mark === "failed" ? (
                <StatusDot mark="failed" />
              ) : (
                <Icon name="checkmark" size={16} xstyle={[intent.success, styles.passed]} />
              )}
            </Row.Leading>
            <Row.Body>
              <Row.Label>{state.label}</Row.Label>
              {state.detail !== "" && <Row.Description>{state.detail}</Row.Description>}
            </Row.Body>
          </Row>
        </div>
        <ol aria-label="Activity" {...props(styles.group, styles.list)}>
          {entries(review, turns).map((entry) => (
            <li key={`${entry.at}-${entry.title}`}>
              <Row>
                <Row.Leading>
                  <Icon name={entry.icon} size={14} />
                </Row.Leading>
                <Row.Body>
                  <Row.Label>{entry.title}</Row.Label>
                  {entry.detail !== undefined && <Row.Description>{entry.detail}</Row.Description>}
                </Row.Body>
                <Row.Meta>
                  <time dateTime={new Date(entry.at).toISOString()}>{when(entry.at)}</time>
                </Row.Meta>
              </Row>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

const styles = create({
  scroll: { flex: 1, minHeight: 0, overflowY: "auto" },
  column: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    paddingInline: 12,
    paddingBlock: "4px 96px",
  },
  group: { display: "flex", flexDirection: "column", gap: 2 },
  list: { margin: 0, padding: 0, listStyle: "none" },
  passed: { color: role.contentInteractiveTertiary },
});
