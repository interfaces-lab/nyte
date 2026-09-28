/**
 * A row between turns, after shadcn's Marker. `default` is a dim note line;
 * `border` frames its content as a heading over a markdown summary. It knows
 * nothing about scrolling or the session item it stands for.
 */
import { BoxRenderable, fg, StyledText } from "@opentui/core";
import { SPACING } from "./constants.ts";
import { omittedLabel, previewLines } from "./format.ts";
import { repaints, TranscriptTextRenderable } from "./surface.ts";
import type { Transcript } from "./surface.ts";
import {
  createMermaidMarkdownRenderer,
  section,
  TranscriptMarkdownRenderable,
} from "./transcript.ts";

export type MarkerProps =
  | { readonly variant: "default"; readonly content: string }
  | { readonly variant: "border"; readonly content: string; readonly summary: string };

export function appendMarker(transcript: Transcript, props: MarkerProps): BoxRenderable {
  const { theme } = transcript;

  switch (props.variant) {
    case "default": {
      const box = section(transcript, "note");

      const text = new TranscriptTextRenderable(transcript.renderer, {
        id: transcript.nextId("note-text"),
        content: props.content,
        fg: theme.dim,
        wrapMode: "word",
      });

      repaints.set(text, () => {
        text.fg = theme.dim;
      });
      box.add(text);

      return box;
    }

    case "border": {
      const preview = previewLines(props.summary, { kind: "head", max: 40 });

      const summary =
        preview.omitted === 0 ? preview.text : `${preview.text}\n${omittedLabel(preview.omitted)}`;

      const card = new BoxRenderable(transcript.renderer, {
        id: transcript.nextId("card"),
        flexDirection: "column",
        border: true,
        borderStyle: "rounded",
        borderColor: theme.promptBorder,
        paddingLeft: 2,
        paddingRight: 2,
        marginTop: SPACING.block,
        width: "100%",
      });

      const heading = new TranscriptTextRenderable(transcript.renderer, {
        id: transcript.nextId("card-heading"),
        content: new StyledText([fg(theme.dim)(props.content)]),
        wrapMode: "word",
      });

      card.add(heading);

      const body =
        summary === ""
          ? undefined
          : new TranscriptMarkdownRenderable(transcript.renderer, {
              renderNode: createMermaidMarkdownRenderer(
                transcript.renderer,
                theme,
                transcript.disclosures,
                { key: "card" },
              ),
              tableOptions: { selectable: true, cellPaddingX: 1 },
              id: transcript.nextId("card-summary"),
              content: summary,
              syntaxStyle: transcript.subtleSyntaxStyle,
              fg: theme.dim,
            });

      if (body !== undefined) card.add(body);
      repaints.set(card, () => {
        card.borderColor = theme.promptBorder;
        heading.content = new StyledText([fg(theme.dim)(props.content)]);
        body?.retheme(theme, transcript.subtleSyntaxStyle, true);
      });
      transcript.container.add(card);

      return card;
    }

    default: {
      const _exhaustive: never = props;

      return _exhaustive;
    }
  }
}
