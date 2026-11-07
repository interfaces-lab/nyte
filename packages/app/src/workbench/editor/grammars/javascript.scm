[
  (statement_block)
  (switch_body)
  (class_body)
  (object)
  (array)
] @fold.delimited

(jsx_element
  open_tag: (jsx_opening_element) @fold.open
  close_tag: (jsx_closing_element) @fold.close) @fold.markup

(comment) @fold.comment
