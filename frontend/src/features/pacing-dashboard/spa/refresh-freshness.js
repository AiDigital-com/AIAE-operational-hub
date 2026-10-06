// workspace/src/lib/dashboard/refresh-freshness.js
// The ONE workspace residence of the shared freshness rule (shared/refresh-freshness.js,
// dashboard refresh spec 2026-10-01), the report-v2 door pattern: every consumer imports
// from here, never from @shared directly.
import RefreshFreshness from '@shared/refresh-freshness';

export const {
  DELIVERY_ALLOWANCE_HOURS,
  summarizeRows,
  platformSummary,
  todayInTz,
  platformFreshness,
  lateFingerprint,
  latePlatforms,
} = RefreshFreshness;

export default RefreshFreshness;
