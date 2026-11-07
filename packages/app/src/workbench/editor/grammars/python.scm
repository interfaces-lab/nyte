(block) @fold.indented

[
  (dictionary)
  (list)
  (tuple)
  (set)
  (parenthesized_expression)
  (argument_list)
  (parameters)
] @fold.delimited

(string
  (string_start) @fold.open
  (string_end) @fold.close) @fold.markup
