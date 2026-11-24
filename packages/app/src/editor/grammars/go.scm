[
  (block)
  (field_declaration_list)
  (interface_type)
  (literal_value)
  (import_spec_list)
  (var_spec_list)
] @fold.delimited

(const_declaration
  "(" @fold.open
  ")" @fold.close) @fold.markup

(comment) @fold.comment
