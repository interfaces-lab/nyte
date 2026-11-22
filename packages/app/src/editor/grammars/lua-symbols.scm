(function_declaration name: (_) @name) @symbol.function

(assignment_statement
  (variable_list name: (_) @name)
  (expression_list value: (function_definition))) @symbol.function
