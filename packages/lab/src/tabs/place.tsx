import { props } from "@stylexjs/stylex";
import type { MouseEvent, ReactElement } from "react";
import { bubbleStyles } from "@nyte-ai/app/conversation/styles.stylex.ts";
import { StatusDot } from "@nyte-ai/app/components/ui.tsx";
import { intent } from "@nyte-ai/ui/surface-theme";
import { Icon, type IconName } from "@nyte-ai/ui/icon";
import { Row } from "@nyte-ai/ui/row";
import { Tabs } from "@nyte-ai/ui/tabs";
import { EnvironmentsSurface } from "../environments/environments-page";
import { environmentsFor } from "../environments/fixtures";
import { chatById, reviewById, type Chat, type ChatMark, type Review } from "./fixtures";
import type { OpenTarget, PanePlace, Place, ReviewSection } from "./model";
import { placeStyles as styles } from "./tabs.stylex";

export interface PlaceInfo {
  readonly title: string;
  readonly folder: string | undefined;
  readonly icon: IconName | undefined;
  readonly mark: ChatMark | undefined;
  readonly path: string;
}

export function placeInfo(place: Place): PlaceInfo {
  switch (place.kind) {
    case "new-chat":
      return { title: "New chat", folder: undefined, icon: "new-chat", mark: undefined, path: "/" };
    case "chat": {
      const chat = chatById(place.chatId);

      return {
        title: chat?.title ?? "Missing chat",
        folder: chat?.folder,
        icon: undefined,
        mark: chat?.mark,
        path: `/session/${place.chatId}`,
      };
    }
    case "review": {
      const review = reviewById(place.reviewId);

      return {
        title: review?.title ?? "Missing review",
        folder: review?.folder,
        icon: "pull-request",
        mark: undefined,
        path: `/review/${review?.number ?? place.reviewId}/${place.section}`,
      };
    }
    case "environments":
      return {
        title: "Environments",
        folder: undefined,
        icon: "server",
        mark: undefined,
        path: "/environments",
      };
    case "customize":
      return {
        title: "Customize",
        folder: undefined,
        icon: "customize",
        mark: undefined,
        path: "/customize",
      };
    default: {
      const _exhaustive: never = place;

      return _exhaustive;
    }
  }
}

/** A chat glyph only speaks when the chat needs a look; a quiet chat has none. */
export function PlaceGlyph({ info }: { readonly info: PlaceInfo }): ReactElement | null {
  if (info.mark !== undefined) return <StatusDot mark={info.mark} />;

  if (info.icon !== undefined) return <Icon name={info.icon} size={13} />;

  return null;
}

/** ⌘-click or middle-click opens a background tab; ⌘⇧-click opens and shows it. */
export function openTarget(event: MouseEvent): OpenTarget {
  if (event.button === 1) return "background";

  if (event.metaKey || event.ctrlKey) return event.shiftKey ? "foreground" : "background";

  return "here";
}

type Open = (place: Place, target: OpenTarget) => void;

function Composer({ placeholder }: { readonly placeholder: string }): ReactElement {
  return (
    <div {...props(styles.dock)}>
      <div {...props(styles.composer)}>
        <span>{placeholder}</span>
        <span {...props(styles.send)}>
          <Icon name="arrow-up" size={14} />
        </span>
      </div>
    </div>
  );
}

function NewChat(): ReactElement {
  return (
    <div {...props(styles.newChat)}>
      <h2 {...props(styles.newChatTitle)}>What should we do in nyte?</h2>
      <Composer placeholder="Ask anything" />
    </div>
  );
}

function ChatView({ chat, onOpen }: { readonly chat: Chat; readonly onOpen: Open }): ReactElement {
  const review = chat.reviewId === undefined ? undefined : reviewById(chat.reviewId);

  return (
    <div {...props(styles.thread)}>
      <div {...props(styles.transcript)}>
        <div {...props(styles.userTurn)}>
          <div {...props(bubbleStyles.default)}>{chat.prompt}</div>
        </div>
        <div {...props(styles.step)}>
          <Icon name="file-text" size={13} />
          {chat.steps}
        </div>
        {chat.mark === "working" || chat.mark === "retry" ? (
          <div {...props(styles.step)}>
            <StatusDot mark="working" />
            Working
          </div>
        ) : (
          <div {...props(styles.reply, chat.mark === "failed" && [intent.danger, styles.failed])}>
            {chat.reply}
          </div>
        )}
        {review !== undefined && (
          <button
            type="button"
            {...props(styles.reviewCard)}
            onClick={(event) =>
              onOpen(
                { kind: "review", reviewId: review.id, section: "overview" },
                openTarget(event),
              )
            }
            onAuxClick={(event) => {
              if (event.button === 1)
                onOpen({ kind: "review", reviewId: review.id, section: "overview" }, "background");
            }}
          >
            <Icon name="pull-request" size={14} />
            <span {...props(styles.reviewCardNumber)}>#{review.number}</span>
            <span {...props(styles.reviewCardTitle)}>{review.title}</span>
            <span {...props(styles.reviewCardHint)}>⌘-click for a new tab</span>
          </button>
        )}
      </div>
      <Composer placeholder={chat.mark === "waiting" ? "Answer the question" : "Reply"} />
    </div>
  );
}

const SECTIONS = [
  ["overview", "Overview"],
  ["guide", "Guide"],
  ["diff", "Diff"],
] as const satisfies readonly (readonly [ReviewSection, string])[];

function Diff({ review }: { readonly review: Review }): ReactElement {
  return (
    <div {...props(styles.files)}>
      {review.files.map((file) => (
        <section key={file.path} {...props(styles.file)}>
          <header {...props(styles.fileHeader)}>
            <Icon name="file" size={12} />
            {file.path}
          </header>
          <pre {...props(styles.code)}>
            {file.lines.map((line, index) => (
              <div
                key={index}
                {...props(
                  styles.line,
                  line.kind === "add" && styles.lineAdd,
                  line.kind === "remove" && styles.lineRemove,
                )}
              >
                {`${line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "} ${line.text}`}
              </div>
            ))}
          </pre>
        </section>
      ))}
    </div>
  );
}

function ReviewView({
  review,
  section,
  onSection,
}: {
  readonly review: Review;
  readonly section: ReviewSection;
  readonly onSection: (section: ReviewSection) => void;
}): ReactElement {
  return (
    <div {...props(styles.page)}>
      <div {...props(styles.pageColumn)}>
        <Tabs.Root
          variant="pill"
          value={section}
          onValueChange={(next: unknown) => {
            const match = SECTIONS.find(([id]) => id === next);

            if (match !== undefined) onSection(match[0]);
          }}
        >
          <Tabs.List aria-label="Review sections">
            {SECTIONS.map(([id, label]) => (
              <Tabs.Tab key={id} value={id}>
                {label}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.Root>
        <h1 {...props(styles.pageTitle)}>{review.title}</h1>
        <div {...props(styles.pageMeta)}>
          <span>#{review.number}</span>
          <span>{review.author}</span>
          <code {...props(styles.branch)}>
            {review.base} ← {review.branch}
          </code>
        </div>
        {section !== "diff" &&
          review.summary.map((paragraph) => (
            <p key={paragraph} {...props(styles.paragraph)}>
              {paragraph}
            </p>
          ))}
        {section === "overview" && (
          <div {...props(styles.fileList)}>
            {review.files.map((file) => (
              <div key={file.path} {...props(styles.fileListRow)}>
                <Icon name="file" size={12} />
                {file.path}
              </div>
            ))}
          </div>
        )}
        {section !== "overview" && <Diff review={review} />}
      </div>
    </div>
  );
}

function Customize(): ReactElement {
  return (
    <div {...props(styles.page)}>
      <div {...props(styles.pageColumn)}>
        <h1 {...props(styles.pageTitle)}>Customize</h1>
        <div {...props(styles.fileList)}>
          {(
            [
              ["skills", "Skills"],
              ["agent", "Agents"],
              ["mcp", "MCP servers"],
              ["apps", "Plugins"],
            ] as const
          ).map(([icon, label]) => (
            <Row key={label} variant="nav">
              <Row.Leading>
                <Icon name={icon} size={14} />
              </Row.Leading>
              <Row.Label>{label}</Row.Label>
            </Row>
          ))}
        </div>
      </div>
    </div>
  );
}

const ENVIRONMENTS = environmentsFor("desktop", true);

export function PlaceView({
  place,
  onOpen,
  onReplace,
}: {
  readonly place: Place;
  readonly onOpen: Open;
  readonly onReplace: (place: PanePlace) => void;
}): ReactElement {
  switch (place.kind) {
    case "new-chat":
      return <NewChat />;
    case "chat": {
      const chat = chatById(place.chatId);

      return chat === undefined ? <NewChat /> : <ChatView chat={chat} onOpen={onOpen} />;
    }
    case "review": {
      const review = reviewById(place.reviewId);

      if (review === undefined) return <NewChat />;

      return (
        <ReviewView
          review={review}
          section={place.section}
          onSection={(section) => onReplace({ ...place, section })}
        />
      );
    }
    case "environments":
      return <EnvironmentsSurface environments={ENVIRONMENTS} home="this-mac" />;
    case "customize":
      return <Customize />;
    default: {
      const _exhaustive: never = place;

      return _exhaustive;
    }
  }
}
