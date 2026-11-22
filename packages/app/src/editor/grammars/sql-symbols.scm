[
  (create_function (object_reference name: (identifier) @name))
  (create_trigger (keyword_trigger) . (object_reference name: (identifier) @name))
] @symbol.function

[
  (create_table (object_reference name: (identifier) @name))
  (create_view (object_reference name: (identifier) @name))
  (create_materialized_view (object_reference name: (identifier) @name))
  (create_type (object_reference name: (identifier) @name))
] @symbol.type
