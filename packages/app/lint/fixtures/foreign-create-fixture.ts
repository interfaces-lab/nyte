// A `create` that is not StyleX's. The rules read the import bindings, so this
// object is not a style object and carries no scale.
const create = (styles: Record<string, Record<string, number>>): Record<string, unknown> => styles;

export const foreign = create({ row: { gap: 7, width: 15 } });
