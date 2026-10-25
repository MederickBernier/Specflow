/** Outcome of a fallible `core` operation. `core` returns these instead of throwing. */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/** Wraps a success value. */
export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

/** Wraps a failure. */
export function err<E>(error: E): { ok: false; error: E } {
  return { ok: false, error };
}
