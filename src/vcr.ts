export function withVCR<T>(_fn: () => Promise<T>): Promise<T> {
  return _fn()
}

export function withStreamingVCR<T>(_fn: () => Promise<T>): Promise<T> {
  return _fn()
}

export function withTokenCountVCR<T>(_fn: () => Promise<T>): Promise<T> {
  return _fn()
}