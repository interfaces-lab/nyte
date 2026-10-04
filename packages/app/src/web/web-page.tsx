import { radius } from "@nyte-ai/ui/schema.stylex";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";

const styles = create({
  page: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    minHeight: "100%",
    padding: 24,
    overflowY: "auto",
    backgroundColor: role.bgBase,
    color: role.contentPrimary,
  },
  column: {
    display: "flex",
    flexDirection: "column",
    gap: 24,
    width: "100%",
    maxWidth: 360,
    marginBlock: "auto",
    paddingBlock: 32,
  },
  header: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
    textAlign: "center",
  },
  mark: { alignSelf: "center", width: 40, height: 40, marginBottom: -8, borderRadius: radius.card },
  title: {
    margin: 0,
    fontSize: type.fontLg,
    fontWeight: 600,
    lineHeight: type.leadingLg,
  },
  description: {
    margin: 0,
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    textWrap: "pretty",
  },
  footer: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
});

export function WebPage({
  title,
  description,
  footer,
  busy,
  children,
}: {
  readonly title?: string;
  readonly description?: ReactNode;
  readonly footer?: ReactNode;
  readonly busy?: boolean;
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <main {...props(styles.page)} aria-busy={busy}>
      <div {...props(styles.column)}>
        <img src="/icon.svg" alt="" width={40} height={40} {...props(styles.mark)} />
        {title !== undefined && (
          <header {...props(styles.header)}>
            <h1 {...props(styles.title)}>{title}</h1>
            {description !== undefined && <p {...props(styles.description)}>{description}</p>}
          </header>
        )}
        {children}
        {footer !== undefined && <footer {...props(styles.footer)}>{footer}</footer>}
      </div>
    </main>
  );
}
