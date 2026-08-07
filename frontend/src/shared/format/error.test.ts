import { describe, expect, it } from "vitest";
import { formatError } from "./error";

const GENERIC_ERROR = "Something went wrong. Please try again.";

describe("formatError", () => {
  it("should return the backend message without the code, timestamp, or correlation id", () => {
    // Given: a backend API exception body carrying a machine-readable code and a message
    const body = {
      code: "OPH_020",
      message: "User already has an active role; revoke it before assigning a new one.",
      timestamp: "2026-06-16T00:00:00Z",
      correlationId: "abc-123",
    };

    // When: the error is formatted
    const result = formatError(body);

    // Then: only the human-readable message is returned
    expect(result).toBe("User already has an active role; revoke it before assigning a new one.");
    expect(result).not.toContain("OPH_020");
    expect(result).not.toContain("correlationId");
  });

  it("should join validation errors by their readable text and drop the field codes", () => {
    // Given: a backend validation error body with per-field codes and messages
    const body = {
      errors: [
        { code: "OPH_017", field: "pageSize", error: "must be at most 100" },
        { code: "OPH_017", field: "pageNumber", error: "must be at least 1" },
      ],
      timestamp: "2026-06-16T00:00:00Z",
      correlationId: "abc-123",
    };

    // When: the error is formatted
    const result = formatError(body);

    // Then: the readable, field-prefixed text is joined and no code leaks
    expect(result).toBe("pageSize: must be at most 100; pageNumber: must be at least 1");
    expect(result).not.toContain("OPH_017");
  });

  it("should return the string as-is when the error is a plain string", () => {
    // Given: a plain string error
    // When: the error is formatted
    // Then: the string is returned unchanged
    expect(formatError("role already assigned")).toBe("role already assigned");
  });

  it("should return the message of an Error instance", () => {
    // Given: a thrown Error
    // When: the error is formatted
    // Then: its message is returned
    expect(formatError(new Error("network unreachable"))).toBe("network unreachable");
  });

  it("should fall back to a generic message for an unrecognized object", () => {
    // Given: an object with no readable message or validation errors
    // When: the error is formatted
    // Then: a generic message is returned, never JSON
    const result = formatError({ status: 500, internal: { trace: "x" } });
    expect(result).toBe(GENERIC_ERROR);
    expect(result).not.toContain("500");
  });

  it("should fall back to a generic message for null or undefined", () => {
    // Given: no error value
    // When/Then: the generic message is returned
    expect(formatError(null)).toBe(GENERIC_ERROR);
    expect(formatError(undefined)).toBe(GENERIC_ERROR);
  });
});
