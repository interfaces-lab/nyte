import { useQuery } from "@tanstack/react-query";
import { create, props } from "@stylexjs/stylex";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import type { SessionId } from "@nyte-ai/sdk";
import { Icon, IconSwap } from "@nyte-ai/ui/icon";
import type { IconName } from "@nyte-ai/ui/icon";
import { MenuItem } from "@nyte-ai/ui/menu";
import { PreviewCardContent, PreviewCardTrigger } from "@nyte-ai/ui/preview-card";
import { Row } from "@nyte-ai/ui/row";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { row, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { nyte } from "../contract/nyte.ts";
import { useChat } from "../chats/index.ts";
import { keys } from "../data/query-client.ts";
import { connected } from "../data/connection.ts";
import { gitStatusWatch } from "../data/watches.ts";
import { useWatch } from "../data/watch-store.ts";
import { chatCardFacts } from "./chat-card-facts.ts";
import { useCopyConfirmation } from "./copy-confirmation.ts";
import type { ChatCardFacts, ChatFact } from "./chat-card-facts.ts";

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

const COPY_LABELS = {
  repository: "Copy Path",
  worktree: "Copy Worktree Path",
  folder: "Copy Path",
} satisfies Record<ChatFact["kind"], string>;

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
  factPrimary: { alignItems: "start" },
  icon: { height: type.leadingSm, color: role.contentTertiary },
  wrap: { whiteSpace: "normal", overflowWrap: "anywhere" },
  copy: { color: role.contentTertiary },
  copyLine: { display: "grid", placeItems: "center", height: type.leadingSm },
  footer: { paddingInline: row.paddingInlineMd, paddingBlockEnd: space.s1 },
});

export function ChatCardTrigger(trigger: ComponentProps<typeof PreviewCardTrigger>): ReactElement {
  return <PreviewCardTrigger delay={OPEN_DELAY_MS} closeDelay={CLOSE_DELAY_MS} {...trigger} />;
}

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

export function ChatCopyMenuItems({
  sessionId,
}: {
  readonly sessionId: SessionId;
}): ReactElement | null {
  const card = useChatCard(sessionId);

  if (card === undefined) return null;
  const branch = card.branch;

  return (
    <>
      {card.facts.map((fact) => (
        <MenuItem
          key={fact.kind}
          icon="copy"
          onClick={() => void navigator.clipboard.writeText(fact.copy)}
        >
          {COPY_LABELS[fact.kind]}
        </MenuItem>
      ))}
      {branch !== undefined && (
        <MenuItem icon="copy" onClick={() => void navigator.clipboard.writeText(branch)}>
          Copy Branch
        </MenuItem>
      )}
    </>
  );
}

function ChatBlock({ sessionId }: { readonly sessionId: SessionId }): ReactElement | null {
  const card = useChatCard(sessionId);

  if (card === undefined) return null;

  return (
    <div {...props(styles.block)}>
      <div {...props(text.base, styles.title)}>{card.title}</div>
      {card.facts.map((fact) => (
        <FactLine key={fact.kind} fact={fact} />
      ))}
    </div>
  );
}

function useChatCard(sessionId: SessionId): ChatCardFacts | undefined {
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

  if (chat.kind !== "ready") return undefined;

  return chatCardFacts({
    chat: chat.chat,
    git,
    repository: repository ?? undefined,
    surface: nyte.clientSurface,
  });
}

function FactLine({ fact }: { readonly fact: ChatFact }): ReactElement {
  const confirmation = useCopyConfirmation();

  return (
    <Row interactive xstyle={styles.fact}>
      <Row.Primary
        aria-description={COPY_LABELS[fact.kind]}
        onClick={() => confirmation.copy(fact.copy)}
        xstyle={styles.factPrimary}
      >
        <Row.Leading xstyle={styles.icon}>
          <Icon name={ICONS[fact.kind]} size="sm" />
        </Row.Leading>
        <Row.Body>
          <Row.Label xstyle={[text.sm, styles.wrap]}>{fact.text}</Row.Label>
          {fact.detail !== undefined && (
            <Row.Description xstyle={styles.wrap}>{fact.detail}</Row.Description>
          )}
        </Row.Body>
        <Row.Meta xstyle={styles.copy}>
          <span {...props(styles.copyLine)}>
            <IconSwap name={confirmation.copied ? "checkmark" : "copy"} size="xs" />
          </span>
        </Row.Meta>
      </Row.Primary>
      <span role="status" {...props(srOnly)}>
        {confirmation.copied ? "Copied" : ""}
      </span>
    </Row>
  );
}
