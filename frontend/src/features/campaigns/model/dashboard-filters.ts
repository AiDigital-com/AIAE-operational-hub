/**
 * Which of the dataset preview's Filters bar popovers is open, and which stage of it (PDI_125, mirroring
 * PDI_115's Reporting model). One state machine replaces the funnel-era per-column popover: `"fields"` is
 * the `+ Filter` field picker, `"values"` is a chosen column's value popover (opened either from the
 * picker or from clicking an existing chip's label), and `"date"` is the persistent Date pill's own
 * window popover.
 */
export type DashboardFilterPopover =
  | { stage: "fields" }
  | { stage: "values"; columnId: string }
  | { stage: "date" };
