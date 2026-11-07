[
  (function_declaration name: (_) @name)
  (generator_function_declaration name: (_) @name)
  (method_definition name: (_) @name)
] @symbol.function

(class_declaration name: (_) @name) @symbol.class

(variable_declarator
  name: (identifier) @name
  value: [
    (arrow_function)
    (function_expression)
    (generator_function)
  ]) @symbol.function

(variable_declarator name: (identifier) @name) @symbol.variable
