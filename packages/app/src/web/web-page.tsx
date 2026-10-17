import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";

const styles = create({
  page: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    height: "100%",
    padding: space.s6,
    overflowY: "auto",
    backgroundColor: role.bgBase,
    color: role.contentPrimary,
  },
  column: {
    display: "flex",
    flexDirection: "column",
    gap: space.s6,
    width: "100%",
    maxWidth: 360,
    marginBlock: "auto",
    paddingBlock: space.s8,
    overflowWrap: "break-word",
  },
  header: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.s2,
    textAlign: "center",
  },
  mark: {
    alignSelf: "center",
    width: 40,
    height: 40,
    marginBottom: `calc(${space.s2} * -1)`,
    borderRadius: radius.card,
  },
  title: {
    margin: 0,
    fontWeight: type.weightSemibold,
  },
  description: {
    margin: 0,
    color: role.contentSecondary,
    textWrap: "pretty",
  },
  footer: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s1,
    color: role.contentSecondary,
  },
});

export function WebPage({
  title,
  description,
  footer,
  busy,
  status,
  children,
}: {
  readonly title?: string;
  readonly description?: ReactNode;
  readonly footer?: ReactNode;
  readonly busy?: boolean;
  readonly status?: string;
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <>
      <main {...props(styles.page)} aria-busy={busy}>
        <div {...props(styles.column)}>
          <img src="/icon.svg" alt="" width={40} height={40} {...props(styles.mark)} />
          {title !== undefined && (
            <header {...props(styles.header)}>
              <h1 {...props(text.lg, styles.title)}>{title}</h1>
              {description !== undefined && (
                <p {...props(text.base, styles.description)}>{description}</p>
              )}
            </header>
          )}
          {children}
          {footer !== undefined && <footer {...props(text.sm, styles.footer)}>{footer}</footer>}
        </div>
      </main>
      <p role="status" {...props(srOnly)}>
        {status}
      </p>
    </>
  );
}
