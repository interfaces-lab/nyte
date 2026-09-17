import type { ReactNode } from "react";
import type { ShellSkin } from "~/shell.stylex";

/*
 * The article header: eyebrow, title, lede, then whatever else the page
 * wants inside the header (Cloud's landing CTAs).
 */
export function ShellHead({
  skin,
  eyebrow,
  title,
  lede,
  children,
}: {
  skin: ShellSkin;
  eyebrow?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className={`${skin}-head`}>
      {eyebrow ? <span className={`${skin}-eyebrow`}>{eyebrow}</span> : null}
      <h1 className={`${skin}-title`}>{title}</h1>
      {lede ? <p className={`${skin}-lede`}>{lede}</p> : null}
      {children}
    </header>
  );
}
