/**
 * Which of the Filters bar's popovers is open, and which stage of it (PDI_115). One state machine
 * replaces the funnel-era `openFilterFor`/`filterAnchor` pair: `"fields"` is the `+ Filter` field
 * picker, `"values"` is a chosen dimension's value popover (opened either from the picker or from
 * clicking an existing chip's label), and `"date"` is the persistent Date pill's own popover.
 */
export type FilterPopover =
  | { stage: "fields" }
  | { stage: "values"; fieldId: string }
  | { stage: "date" };
