[
  (function_declaration name: (_) @name)
  (generator_function_declaration name: (_) @name)
  (method_definition name: (_) @name)
] @symbol.function

[
  (class_declaration name: (_) @name)
  (abstract_class_declaration name: (_) @name)
] @symbol.class

[
  (interface_declaration name: (_) @name)
  (enum_declaration name: (_) @name)
  (type_alias_declaration name: (_) @name)
] @symbol.type

(variable_declarator
  name: (identifier) @name
  value: [
    (arrow_function)
    (function_expression)
    (generator_function)
  ]) @symbol.function

(variable_declarator name: (identifier) @name) @symbol.variable
