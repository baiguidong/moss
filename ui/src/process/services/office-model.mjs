/**
 * Stable metadata for browser Office models.
 *
 * The renderer intentionally receives the legacy top-level fields for now so
 * existing viewers keep working. A future OpenXML/WASM importer can replace
 * `importer` and populate the same model envelope without changing routing or
 * viewer selection.
 */
export const OFFICE_MODEL_SCHEMA = 'moss.office-model/v1';

export function annotateOfficeModel(data, { kind, format, importer, diagnostics = [] }) {
  return {
    ...data,
    model: {
      schema: OFFICE_MODEL_SCHEMA,
      kind,
      format,
      importer,
      diagnostics: Array.isArray(diagnostics) ? diagnostics : [],
    },
  };
}
