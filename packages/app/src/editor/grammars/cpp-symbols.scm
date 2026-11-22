[
  (function_definition
    declarator: (function_declarator
      declarator: [
        (identifier)
        (field_identifier)
        (qualified_identifier)
        (destructor_name)
        (operator_name)
      ] @name))
  (function_definition
    declarator: (pointer_declarator
      declarator: (function_declarator
        declarator: [
          (identifier)
          (field_identifier)
          (qualified_identifier)
          (operator_name)
        ] @name)))
  (function_definition
    declarator: (reference_declarator
      (function_declarator
        declarator: [
          (identifier)
          (field_identifier)
          (qualified_identifier)
          (operator_name)
        ] @name)))
  (field_declaration
    declarator: (function_declarator
      declarator: [
        (field_identifier)
        (destructor_name)
        (operator_name)
      ] @name))
  (field_declaration
    declarator: (pointer_declarator
      declarator: (function_declarator
        declarator: [
          (field_identifier)
          (operator_name)
        ] @name)))
  (field_declaration
    declarator: (reference_declarator
      (function_declarator
        declarator: [
          (field_identifier)
          (operator_name)
        ] @name)))
  (declaration
    declarator: (function_declarator
      declarator: [
        (identifier)
        (qualified_identifier)
        (destructor_name)
        (operator_name)
      ] @name))
  (declaration
    declarator: (pointer_declarator
      declarator: (function_declarator
        declarator: [
          (identifier)
          (qualified_identifier)
          (operator_name)
        ] @name)))
  (declaration
    declarator: (reference_declarator
      (function_declarator
        declarator: [
          (identifier)
          (qualified_identifier)
          (operator_name)
        ] @name)))
] @symbol.function

(class_specifier name: (type_identifier) @name body: (field_declaration_list)) @symbol.class

[
  (namespace_definition name: (namespace_identifier) @name body: (declaration_list))
  (struct_specifier name: (type_identifier) @name body: (field_declaration_list))
  (union_specifier name: (type_identifier) @name body: (field_declaration_list))
  (enum_specifier name: (type_identifier) @name body: (enumerator_list))
  (alias_declaration name: (type_identifier) @name)
  (type_definition declarator: (type_identifier) @name)
] @symbol.type
