export function containsProjectConfirmationBypass(value, depth = 0) {
  if (depth > 8 || value === null || value === undefined) return false;
  if (Array.isArray(value)) {
    return value.some((entry) => containsProjectConfirmationBypass(entry, depth + 1));
  }
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    return false;
  }
  if (value.skip_confirmation === true || value.skipConfirmation === true) return true;
  return Object.values(value).some((entry) => containsProjectConfirmationBypass(entry, depth + 1));
}
