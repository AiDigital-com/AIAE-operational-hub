/**
 * Joins truthy class-name fragments into a single string for conditional BEM modifiers.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
