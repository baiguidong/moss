import manifestSchema from './schemas/app-manifest.schema.json' with { type: 'json' }

// Use the public Manifest contract as the category and display-order authority.
export const APP_CATEGORIES = Object.freeze(manifestSchema.properties.category.oneOf
  .map(({ const: id, title: label }) => Object.freeze({ id, label })))

export function getAppCategory(value) {
  return APP_CATEGORIES.find(category => category.id === value) || APP_CATEGORIES.at(-1)
}
