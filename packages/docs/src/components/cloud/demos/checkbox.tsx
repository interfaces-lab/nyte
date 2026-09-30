"use client";

import { Checkbox } from "@nyte-ai/ui/checkbox";
import { t } from "@nyte-ai/ui/vars.stylex";
import { create, props } from "@stylexjs/stylex";
import { useState } from "react";

const styles = create({
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    color: t.contentPrimary,
    fontFamily: t.fontSans,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
  },
  item: { display: "flex", alignItems: "center", gap: 8 },
});

const files = ["sidebar.tsx", "row.tsx", "checkbox.tsx"];

export function CheckboxDemo() {
  const [viewed, setViewed] = useState<readonly string[]>(["row.tsx"]);

  return (
    <div {...props(styles.list)}>
      <label {...props(styles.item)}>
        <Checkbox
          checked={viewed.length === files.length}
          indeterminate={viewed.length > 0 && viewed.length < files.length}
          onCheckedChange={(checked) => setViewed(checked ? files : [])}
        />
        All files viewed
      </label>
      {files.map((file) => (
        <label key={file} {...props(styles.item)}>
          <Checkbox
            checked={viewed.includes(file)}
            onCheckedChange={(checked) =>
              setViewed((current) =>
                checked ? [...current, file] : current.filter((path) => path !== file),
              )
            }
          />
          {file}
        </label>
      ))}
    </div>
  );
}
