import { create } from "@stylexjs/stylex";
import { Button } from "@nyte-ai/ui/button";
import { Row } from "@nyte-ai/ui/row";
import { Dialog } from "@nyte-ai/ui/dialog";
import { text } from "@nyte-ai/ui/styles/text.stylex";

const styles = create({
  placed: { marginBlockStart: 8, alignSelf: "flex-end", width: "100%" },
  padded: { paddingInline: 16, backgroundColor: "red" },
  rowHooks: { "--_row-fill": "transparent", "--_row-padding-inline": "6px", gap: 8 },
  rowPaint: { boxShadow: "none" },
  anything: { padding: 4, color: "red" },
});

export function Fixture({ wide }: { readonly wide: boolean }) {
  return (
    <>
      <Button xstyle={styles.placed}>Placed</Button>
      {/* @ts-expect-error padding and colour are Button's; the lint rule says what to use */}
      <Button xstyle={[styles.placed, wide && styles.padded]}>Padded</Button>
      {/* @ts-expect-error type is Button's; the lint rule says what to use */}
      <Button xstyle={text.sm}>Typed</Button>
      <Row xstyle={styles.rowHooks}>Hooks</Row>
      {/* @ts-expect-error box shadow is Row's; the lint rule says what to use */}
      <Row xstyle={styles.rowPaint}>Paint</Row>
      <Row variant="bare" xstyle={styles.rowPaint}>
        Bare
      </Row>
      <Dialog.Trigger xstyle={styles.anything}>Host</Dialog.Trigger>
      <Button className="p-4">Classed</Button>
      <Button style={{ padding: 13 }}>Inline</Button>
      <Dialog.Trigger className="p-4">HostClassed</Dialog.Trigger>
    </>
  );
}
