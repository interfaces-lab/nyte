[
  (function_declaration
    parameters: (parameters) @fold.open
    "end" @fold.close)
  (function_definition
    parameters: (parameters) @fold.open
    "end" @fold.close)
  (for_statement
    "do" @fold.open
    "end" @fold.close)
  (while_statement
    "do" @fold.open
    "end" @fold.close)
  (do_statement
    "do" @fold.open
    "end" @fold.close)
  (repeat_statement
    "repeat" @fold.open
    "until" @fold.close)
] @fold.markup

[
  (if_statement consequence: (block) @fold.indented)
  (elseif_statement consequence: (block) @fold.indented)
  (else_statement body: (block) @fold.indented)
]

(table_constructor) @fold.delimited

(comment) @fold.comment
