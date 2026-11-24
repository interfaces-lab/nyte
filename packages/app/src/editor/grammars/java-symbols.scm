[
  (method_declaration name: (identifier) @name)
  (constructor_declaration name: (identifier) @name)
  (compact_constructor_declaration name: (identifier) @name)
] @symbol.function

[
  (class_declaration name: (identifier) @name)
  (record_declaration name: (identifier) @name)
] @symbol.class

[
  (interface_declaration name: (identifier) @name)
  (enum_declaration name: (identifier) @name)
  (annotation_type_declaration name: (identifier) @name)
] @symbol.type
