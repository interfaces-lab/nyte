(block_mapping_pair
  value: (block_node
    [
      (block_mapping)
      (block_sequence)
      (block_scalar)
    ] @fold.value)) @fold.key

(block_sequence_item
  (block_node)) @fold.tail

[
  (flow_mapping)
  (flow_sequence)
] @fold.delimited
