import type { ReactNode } from "react";

/*
 * The article header: eyebrow, title, lede, then whatever else the page
 * wants inside the header (Cloud's landing CTAs).
 */
export function ShellHead({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="shell-head">
      {eyebrow ? <span className="shell-eyebrow">{eyebrow}</span> : null}
      <h1 className="shell-title">{title}</h1>
      {lede ? <p className="shell-lede">{lede}</p> : null}
      {children}
    </header>
  );
}
