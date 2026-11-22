(module "module" @fold.open "end" @fold.close) @fold.markup
(class "class" @fold.open "end" @fold.close) @fold.markup
(singleton_class "class" @fold.open "end" @fold.close) @fold.markup
(method "def" @fold.open "end" @fold.close) @fold.markup
(singleton_method "def" @fold.open "end" @fold.close) @fold.markup
(do_block "do" @fold.open "end" @fold.close) @fold.markup
(if "if" @fold.open "end" @fold.close) @fold.markup
(unless "unless" @fold.open "end" @fold.close) @fold.markup
(case "case" @fold.open "end" @fold.close) @fold.markup
(case_match "case" @fold.open "end" @fold.close) @fold.markup
(begin "begin" @fold.open "end" @fold.close) @fold.markup
(while "while" @fold.open body: (do "end" @fold.close)) @fold.markup
(until "until" @fold.open body: (do "end" @fold.close)) @fold.markup
(for "for" @fold.open body: (do "end" @fold.close)) @fold.markup

[
  (block)
  (hash)
  (array)
  (argument_list)
  (method_parameters)
  (parenthesized_statements)
] @fold.delimited

(comment) @fold.comment
