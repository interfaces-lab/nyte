[
  (column_definitions)
  (enum_elements)
  (cte)
  (subquery)
  (parenthesized_expression)
  (list)
] @fold.delimited

(block
  (keyword_begin) @fold.open
  (keyword_end) @fold.close) @fold.markup

(case
  (keyword_case) @fold.open
  (keyword_end) @fold.close) @fold.markup

(transaction
  (keyword_begin) @fold.open
  (keyword_commit) @fold.close) @fold.markup

(transaction
  (keyword_begin) @fold.open
  (keyword_rollback) @fold.close) @fold.markup

(function_body
  (dollar_quote) @fold.open
  (dollar_quote) @fold.close) @fold.markup

(marginalia) @fold.comment
