/**
 * Error carrying the HTTP status of a failed API call, alongside the human-readable message.
 *
 * Subclasses {@link Error}, so existing callers that only read `.message` (e.g. via `formatError`)
 * keep working; callers that need to branch on the outcome (such as distinguishing a deliberate 403
 * from a transient failure) can read `.status`.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}
