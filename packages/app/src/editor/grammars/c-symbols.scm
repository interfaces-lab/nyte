[
  (function_definition
    declarator: (function_declarator declarator: (identifier) @name))
  (function_definition
    declarator: (pointer_declarator
      declarator: (function_declarator declarator: (identifier) @name)))
  (declaration
    declarator: (function_declarator declarator: (identifier) @name))
  (declaration
    declarator: (pointer_declarator
      declarator: (function_declarator declarator: (identifier) @name)))
] @symbol.function

[
  (struct_specifier name: (type_identifier) @name body: (field_declaration_list))
  (union_specifier name: (type_identifier) @name body: (field_declaration_list))
  (enum_specifier name: (type_identifier) @name body: (enumerator_list))
  (type_definition declarator: (type_identifier) @name)
] @symbol.type
