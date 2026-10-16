// Preserve binary results used by document/preview APIs across JSON transport.
export function stringifyWire(value) {
  return JSON.stringify(value, (_key, item) => {
    if (item === undefined) return { $mossUndefined: true };
    if (item instanceof ArrayBuffer) return { $mossBinary: Array.from(new Uint8Array(item)) };
    if (ArrayBuffer.isView(item)) return { $mossBinary: Array.from(new Uint8Array(item.buffer, item.byteOffset, item.byteLength)) };
    return item;
  });
}

export function parseWire(value) {
  return JSON.parse(value, (_key, item) => {
    if (item && Object.keys(item).length === 1 && item.$mossUndefined === true) return undefined;
    if (item && Object.keys(item).length === 1 && Array.isArray(item.$mossBinary)) {
      return Uint8Array.from(item.$mossBinary).buffer;
    }
    return item;
  });
}
