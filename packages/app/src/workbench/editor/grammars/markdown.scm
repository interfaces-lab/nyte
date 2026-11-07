(section
  [
    (atx_heading)
    (setext_heading)
  ] @fold.header) @fold.section

(fenced_code_block
  (fenced_code_block_delimiter) @fold.open
  (fenced_code_block_delimiter) @fold.close) @fold.markup

[
  (list_item)
  (block_quote)
  (indented_code_block)
] @fold.tail
