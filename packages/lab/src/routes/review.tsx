import { create, props } from "@stylexjs/stylex";
import { createFileRoute } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { Tabs } from "@nyte-ai/ui/tabs";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { MessagesPage } from "../messages/page";
import { RequestsPage } from "../requests/page";
import { ReviewPage } from "../review/page";

const VIEWS = [
  { value: "demo", label: "Demo" },
  { value: "requests", label: "Requests" },
  { value: "messages", label: "Messages" },
] as const satisfies readonly { readonly value: View; readonly label: string }[];

const ReviewSearch = Type.Object({
  id: Type.Optional(Type.String()),
  view: Type.Optional(
    Type.Union([Type.Literal("demo"), Type.Literal("requests"), Type.Literal("messages")]),
  ),
});

type View = NonNullable<Static<typeof ReviewSearch>["view"]>;

export const Route = createFileRoute("/review")({
  validateSearch: (search): Static<typeof ReviewSearch> =>
    Value.Check(ReviewSearch, search) ? search : {},
  component: ReviewRoute,
  head: () => ({ meta: [{ title: "Lab · Review" }] }),
});

/** The review demo, the requests it sends core, and the messages it draws, one tab each. */
function ReviewRoute(): ReactElement {
  const { id, view = "demo" } = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <Tabs.Root
      variant="segmented"
      value={view}
      xstyle={styles.root}
      onValueChange={(next) => {
        const picked = VIEWS.find((candidate) => candidate.value === next);

        if (picked !== undefined)
          void navigate({
            search: (current) => ({ ...current, view: picked.value }),
            replace: true,
          });
      }}
    >
      <div {...props(styles.bar)}>
        <Tabs.List aria-label="Review views">
          {VIEWS.map((candidate) => (
            <Tabs.Tab key={candidate.value} value={candidate.value}>
              {candidate.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </div>
      <Tabs.Panel value="demo" xstyle={styles.panel}>
        <ReviewPage initialReview={id} />
      </Tabs.Panel>
      <Tabs.Panel value="requests" xstyle={styles.panel}>
        <RequestsPage />
      </Tabs.Panel>
      <Tabs.Panel value="messages" xstyle={styles.panel}>
        <MessagesPage />
      </Tabs.Panel>
    </Tabs.Root>
  );
}

const styles = create({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100dvh",
    backgroundColor: role.sidebarMaterial,
    color: role.contentPrimary,
    fontFamily: type.fontSans,
  },
  bar: {
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    paddingBlock: space.s2,
    paddingInline: space.s3,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondaryTranslucent,
  },
  panel: { flex: 1, minHeight: 0 },
});
