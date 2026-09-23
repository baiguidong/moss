export class DatabaseError extends Error {
  constructor(
    readonly code:
      'UNIQUE_CONSTRAINT' | 'FOREIGN_KEY_CONSTRAINT' | 'DATABASE_ERROR',
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause })
    this.name = 'DatabaseError'
  }
}

export function normalizeDatabaseError(error: unknown): Error {
  if (error instanceof DatabaseError) return error
  const e = (error ?? {}) as {
    code?: string
    errcode?: number
    message?: string
  }
  if (
    e.code === 'ER_DUP_ENTRY' ||
    /UNIQUE constraint failed/.test(e.message || '')
  ) {
    return new DatabaseError(
      'UNIQUE_CONSTRAINT',
      'UNIQUE constraint failed',
      error,
    )
  }
  if (
    ['ER_NO_REFERENCED_ROW_2', 'ER_ROW_IS_REFERENCED_2'].includes(
      e.code || '',
    ) ||
    /FOREIGN KEY constraint failed/.test(e.message || '')
  ) {
    return new DatabaseError(
      'FOREIGN_KEY_CONSTRAINT',
      'Foreign key constraint failed',
      error,
    )
  }
  return error instanceof Error
    ? error
    : new DatabaseError('DATABASE_ERROR', 'Database operation failed', error)
}
