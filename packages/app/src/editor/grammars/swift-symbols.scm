[
  (function_declaration name: (simple_identifier) @name)
  (protocol_function_declaration name: (simple_identifier) @name)
] @symbol.function

[
  (class_declaration "class" name: (type_identifier) @name)
  (class_declaration "actor" name: (type_identifier) @name)
] @symbol.class

[
  (class_declaration "struct" name: (type_identifier) @name)
  (class_declaration "enum" name: (type_identifier) @name)
  (class_declaration "extension" name: (user_type (type_identifier) @name))
  (protocol_declaration name: (type_identifier) @name)
  (typealias_declaration name: (type_identifier) @name)
] @symbol.type
