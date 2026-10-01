// ESM wrapper for shared/kpi-band.js (UMD/CJS module) — the single source of
// CTR/VCR band coloring, also consumed server-side by dash-gate/lib/health.mjs
// for the Overview KPI sparklines. Do not duplicate the logic here; it lives in
// shared/. Consumers: KpiPlanFact, KpiTrend.
import KpiBand from '@shared/kpi-band';

export const kpiBandStatus = KpiBand.kpiBandStatus;
export const bandFromNotify = KpiBand.bandFromNotify;
