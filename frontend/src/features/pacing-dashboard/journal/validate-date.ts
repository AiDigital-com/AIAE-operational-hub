/**
 * Journal note date validation (§15, US-139) - matches the retired SPA's `JournalPanel.jsx`
 * `handleAdd`/`saveEdit` messages verbatim. Both the add form and the inline row editor use a plain
 * `<input type="date">`, which only *hints* at `min`/`max` - a typed or pasted value sails straight
 * through - so this check has to run in JS on both the add path and the edit path. Kept in one place
 * so neither path can drift from the other.
 */
export interface JournalDateBounds {
  /** Flight start (`PacingRowV1.flightStart`), or "" when the pacing has none. */
  minDate: string;
  /** `flightEnd < today ? flightEnd : today` - already computed by the caller, do not recompute here. */
  maxDate: string;
  /** Flight end, used only to pick which "too late" message applies. */
  flightEnd?: string;
  /** Today's date (`YYYY-MM-DD`), used for the same choice. */
  today: string;
}

/** Returns the reference's error message for an out-of-bounds date, or `null` when the date is fine. */
export function validateJournalDate(date: string, { minDate, maxDate, flightEnd, today }: JournalDateBounds): string | null {
  if (date && minDate && date < minDate) {
    return `Date is before flight start (${minDate})`;
  }
  if (date && date > maxDate) {
    return flightEnd && flightEnd < today ? `Date cannot be after flight end (${flightEnd})` : "Date cannot be after today";
  }
  return null;
}
