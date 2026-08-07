const GENERIC_MESSAGE = "Something went wrong. Please try again.";

interface ApiExceptionBody {
  message?: unknown;
}

interface ValidationErrorBody {
  errors?: Array<{ error?: unknown; field?: unknown }>;
}

/**
 * Extracts the human-readable message from a backend API exception body, if present.
 */
function apiExceptionMessage(value: object): string | undefined {
  const message = (value as ApiExceptionBody).message;
  return typeof message === "string" && message.trim() ? message : undefined;
}

/**
 * Joins the human-readable parts of a backend validation error body, if present.
 *
 * Only the readable `error` text (optionally prefixed by the field) is surfaced; machine-readable
 * codes are intentionally dropped so they never reach the user.
 */
function validationMessage(value: object): string | undefined {
  const { errors } = value as ValidationErrorBody;
  if (!Array.isArray(errors) || errors.length === 0) return undefined;
  const parts = errors
    .map((entry) => {
      const text = typeof entry?.error === "string" ? entry.error.trim() : "";
      if (!text) return "";
      const field = typeof entry?.field === "string" ? entry.field.trim() : "";
      return field ? `${field}: ${text}` : text;
    })
    .filter(Boolean);
  return parts.length ? parts.join("; ") : undefined;
}

/**
 * Renders an unknown thrown/query value into a human-readable message for the UI.
 *
 * Backend error codes, correlation ids, timestamps, and HTTP status are never surfaced: only the
 * backend's human-readable `message` (API exceptions) or `errors[].error` text (validation
 * failures) is shown, falling back to a generic message when no readable text is available.
 */
export function formatError(error: unknown): string {
  if (!error) return GENERIC_MESSAGE;
  if (typeof error === "string") return error.trim() || GENERIC_MESSAGE;
  if (error instanceof Error) return error.message.trim() || GENERIC_MESSAGE;
  if (typeof error === "object") {
    return apiExceptionMessage(error) ?? validationMessage(error) ?? GENERIC_MESSAGE;
  }
  return GENERIC_MESSAGE;
}
