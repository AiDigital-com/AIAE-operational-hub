// Period model derived from LI containers — used by PeriodPicker UI and
// buildScopedPlansForPeriod. A period is one fs..fe window across LIs.
//
// The extraction/lookup logic now lives in the shared core
// (PacingCore.extractPeriods / findPeriodForAsOf / periodKeyOf) so the
// dashboard, dash-gate health (Overview), and n8n (Slack) all derive identical
// periods and scope to the same numbers. This module is a thin workspace-facing
// re-export; usePeriods.js layers a WeakMap cache over extractPeriods.
//
// Where periods come from (per migration 013 + spec 2026-05-14-split-containers):
//   1. `date_children` inside any container — explicit temporal sub-periods
//      (e.g. monthly splits). PRIMARY source.
//   2. Standalone temporal containers (sub-window, no date_children). SECONDARY.
// Excluded: the full-flight "Initial" container; any container/child with
// target_impressions <= 0.
import PacingCore from './pacing-core.js';

export const periodKeyOf = PacingCore.periodKeyOf;
export const extractPeriods = PacingCore.extractPeriods;
export const findPeriodForAsOf = PacingCore.findPeriodForAsOf;
// Canonical period+state resolver (in_period / ended / upcoming / no_period, no
// auto-advance) — used by the store on load / selectPeriod / saveSettings so the
// workspace resolves periods exactly like dash-gate health and n8n.
export const resolvePeriodKey = PacingCore.resolvePeriodKey;
