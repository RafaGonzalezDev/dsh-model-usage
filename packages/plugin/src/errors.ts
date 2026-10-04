/** A failure with a stable code, safe to carry across the Remote boundary. */
export interface SafeError {
  code: string;
  message: string;
}

/** Raised by the usage pipeline; `code` is part of the observable contract. */
export class UsageError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'UsageError';
    this.code = code;
  }
}

/** Reduce any thrown value to a code and message that never leak internals. */
export function safeError(error: unknown): SafeError {
  if (error instanceof UsageError) return { code: error.code, message: error.message };
  if (error instanceof Error) return { code: 'USAGE_FAILED', message: error.message };
  return { code: 'USAGE_FAILED', message: 'The usage aggregate could not be produced.' };
}

/** Reject as soon as the caller cancels, with a stable code. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new UsageError('USAGE_ABORTED', 'The usage request was cancelled.');
}
