import { useQuery } from "@tanstack/react-query";
import { create, props } from "@stylexjs/stylex";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import type { SessionId } from "@nyte-ai/sdk";
import { Icon } from "@nyte-ai/ui/icon";
import type { IconName } from "@nyte-ai/ui/icon";
import { PreviewCardContent, PreviewCardTrigger } from "@nyte-ai/ui/preview-card";
import { Row } from "@nyte-ai/ui/row";
import { row, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { nyte } from "../contract/nyte.ts";
import { useChat } from "../chats/index.ts";
import { keys } from "../queries.ts";
import { connected, gitStatusWatch, useWatch } from "../sdk.tsx";
import { chatCardFacts } from "./chat-card-facts.ts";
import { useCopyConfirmation } from "./copy-confirmation.ts";
import type { ChatFact } from "./chat-card-facts.ts";

const OPEN_DELAY_MS = 250;

const CLOSE_DELAY_MS = 100;

const PLACEMENTS = {
  row: { side: "right", align: "start", sideOffset: 4 },
  tab: { side: "bottom", align: "center", sideOffset: 8 },
} as const;

const ICONS = {
  repository: "git-branch",
  worktree: "git",
  folder: "folder",
} satisfies Record<ChatFact["kind"], IconName>;

const styles = create({
  card: { gap: space.s2, padding: space.s1 },
  block: { display: "flex", flexDirection: "column" },
  title: {
    paddingInline: row.paddingInlineMd,
    paddingBlock: space.s1,
    fontWeight: type.weightMedium,
    overflowWrap: "anywhere",
  },
  fact: { paddingBlock: space.s1 },
  icon: { color: role.contentTertiary },
  wrap: { whiteSpace: "normal", overflowWrap: "anywhere" },
  copy: { color: role.contentTertiary },
  footer: { paddingInline: row.paddingInlineMd, paddingBlockEnd: space.s1 },
});

/** The element a chat card opens from, after a short rest of the pointer or on keyboard focus. */
export function ChatCardTrigger(trigger: ComponentProps<typeof PreviewCardTrigger>): ReactElement {
  return <PreviewCardTrigger delay={OPEN_DELAY_MS} closeDelay={CLOSE_DELAY_MS} {...trigger} />;
}

/**
 * The card about the chats behind a sidebar row or a tab: one block per chat,
 * the focused pane's first, or only `label` when there is no chat behind it.
 */
export function ChatCardContent({
  placement,
  label,
  sessions,
  footer,
}: {
  readonly placement: keyof typeof PLACEMENTS;
  readonly label: string;
  readonly sessions: readonly SessionId[];
  readonly footer?: ReactNode;
}): ReactElement {
  return (
    <PreviewCardContent {...PLACEMENTS[placement]} xstyle={styles.card}>
      {sessions.length === 0 ? (
        <div {...props(text.base, styles.title)}>{label}</div>
      ) : (
        sessions.map((sessionId) => <ChatBlock key={sessionId} sessionId={sessionId} />)
      )}
      {footer !== undefined && <div {...props(styles.footer)}>{footer}</div>}
    </PreviewCardContent>
  );
}

function ChatBlock({ sessionId }: { readonly sessionId: SessionId }): ReactElement | null {
  const chat = useChat(sessionId);

  const workspace =
    chat.kind === "ready" && chat.chat.location.kind === "folder"
      ? chat.chat.location.workspace
      : undefined;
  const git = useWatch(workspace === undefined ? undefined : gitStatusWatch(workspace)).value;

  const repository = useQuery({
    queryKey: [...keys.github, "repository", workspace],
    queryFn: async () => {
      if (workspace === undefined) return null;
      const github = await (await connected()).workspace(workspace).github();

      return github.kind === "available" ? ((await github.api.state()).repository ?? null) : null;
    },
    enabled: workspace !== undefined,
    staleTime: 30_000,
  }).data;

  if (chat.kind !== "ready") return null;

  const card = chatCardFacts({
    chat: chat.chat,
    git,
    repository: repository ?? undefined,
    surface: nyte.clientSurface,
  });

  return (
    <div {...props(styles.block)}>
      <div {...props(text.base, styles.title)}>{card.title}</div>
      {card.facts.map((fact) => (
        <FactLine key={fact.kind} fact={fact} />
      ))}
    </div>
  );
}

function FactLine({ fact }: { readonly fact: ChatFact }): ReactElement {
  const confirmation = useCopyConfirmation();

  return (
    <Row interactive xstyle={styles.fact}>
      <Row.Primary
        aria-description={confirmation.copied ? "Copied" : "Click to copy"}
        onClick={() => confirmation.copy(fact.copy)}
      >
        <Row.Leading xstyle={styles.icon}>
          <Icon name={ICONS[fact.kind]} size={14} />
        </Row.Leading>
        <Row.Body>
          <Row.Label xstyle={[text.sm, styles.wrap]}>{fact.text}</Row.Label>
          {fact.detail !== undefined && (
            <Row.Description xstyle={styles.wrap}>{fact.detail}</Row.Description>
          )}
        </Row.Body>
        <Row.Meta xstyle={styles.copy}>
          <Icon name={confirmation.copied ? "checkmark" : "copy"} size={12} />
        </Row.Meta>
      </Row.Primary>
    </Row>
  );
}
