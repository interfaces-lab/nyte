[
  (compound_statement)
  (subshell)
  (do_group)
  (if_statement)
  (case_statement)
  (array)
] @fold.delimited

(heredoc_redirect
  (heredoc_start) @fold.open
  (heredoc_body) @fold.body
  (heredoc_end) @fold.close) @fold.heredoc
