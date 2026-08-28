const CREDENTIAL_BASE_SNAPSHOT = Symbol.for('moss.credential-base-snapshot.v1');

function isCredentialRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneCredentialValue(value) {
  if (Array.isArray(value)) return value.map(cloneCredentialValue);
  if (isCredentialRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, cloneCredentialValue(nested)]),
    );
  }
  return value;
}

function credentialValuesEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => credentialValuesEqual(value, right[index]));
  }
  if (!isCredentialRecord(left) || !isCredentialRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => (
      Object.hasOwn(right, key) && credentialValuesEqual(left[key], right[key])
    ));
}

function overlayCredentialValue(current, proposed) {
  if (!isCredentialRecord(current) || !isCredentialRecord(proposed)) {
    return cloneCredentialValue(proposed);
  }
  const result = cloneCredentialValue(current);
  for (const [key, value] of Object.entries(proposed)) {
    result[key] = overlayCredentialValue(current[key], value);
  }
  return result;
}

function applyCredentialDelta(base, proposed, current) {
  if (credentialValuesEqual(base, proposed)) return cloneCredentialValue(current);
  if (!isCredentialRecord(base) || !isCredentialRecord(proposed)) {
    return cloneCredentialValue(proposed);
  }

  const result = isCredentialRecord(current) ? cloneCredentialValue(current) : {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(proposed)])) {
    if (!Object.hasOwn(proposed, key)) {
      delete result[key];
    } else if (!Object.hasOwn(base, key)) {
      result[key] = cloneCredentialValue(proposed[key]);
    } else {
      result[key] = applyCredentialDelta(base[key], proposed[key], current?.[key]);
    }
  }
  return result;
}

export function attachCredentialBaseSnapshot(data) {
  if (!isCredentialRecord(data)) return data;
  Object.defineProperty(data, CREDENTIAL_BASE_SNAPSHOT, {
    value: cloneCredentialValue(data),
    enumerable: false,
  });
  return data;
}

// Snapshot-backed updates apply only the caller's delta. Values without a
// snapshot are overlaid, which protects unrelated entries during first writes.
export function mergeCredentialUpdate(proposed, current) {
  if (!isCredentialRecord(proposed)) {
    throw new Error('Credential update must be an object.');
  }
  const normalizedCurrent = isCredentialRecord(current) ? current : {};
  const base = proposed[CREDENTIAL_BASE_SNAPSHOT];
  return isCredentialRecord(base)
    ? applyCredentialDelta(base, proposed, normalizedCurrent)
    : overlayCredentialValue(normalizedCurrent, proposed);
}
