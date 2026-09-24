/**
 * Instancio-equivalent model factories.
 *
 * TypeScript erases types at runtime, so there is no reflection-based generator
 * like Instancio. These typed factories are the practical analog: every field is
 * populated with randomized, schema-realistic data, and each test passes only the
 * overrides relevant to its assertion. Tests must never hand-build a DTO field by
 * field — call the matching factory instead.
 */
import type { AgencyClientV1, AgencyPageResponseV1, AgencyV1 } from "../features/agencies/types";
import type {
  CampaignPageResponseV1,
  CampaignV1,
  InsertionOrderLineItemV1,
  InsertionOrderV1,
} from "../features/campaigns/types";
import type { ClientPageResponseV1, ClientV1 } from "../features/clients/types";
import type {
  CampaignRefV1,
  PacingAlertV1,
  PacingListResponseV1,
  PacingNsDiffCountsV1,
  PacingNsDiffCoveredByV1,
  PacingNsDiffForeignCampaignV1,
  PacingNsDiffMissingInNetsuiteV1,
  PacingNsDiffMissingInPacingV1,
  PacingNsDiffOwnerMismatchV1,
  PacingNsDiffReportV1,
  PacingNsDiffSummaryV1,
  PacingRowV1,
  PacingScopeV1,
} from "../features/pacing-overview/types";
import type {
  PacingAlertsConfigV1,
  PacingDashboardCampaignV1,
  PacingDashboardV1,
  PacingJournalEntryV1,
  PacingLibraryEntryV1,
  PacingLineItemPlanV1,
  PacingNotifySettingsV1,
  PacingRefreshStatusV1,
} from "../features/pacing-dashboard/types";
import type {
  PacingCreateResultV1,
  PacingDraftLineItemV1,
  PacingDraftV1,
  PacingInsertionOrderV1,
} from "../features/pacing-create/types";
import type {
  AssignRoleRequestV1,
  HubUserSummaryV1,
  RoleAssignmentV1,
  RoleV1,
  ScopeTypeV1,
  UserV1,
} from "../features/rbac/types";

let sequence = 0;

function nextInt(): number {
  sequence += 1;
  return sequence;
}

function randomInt(maxExclusive: number): number {
  return Math.floor(Math.random() * maxExclusive);
}

function randomString(prefix: string): string {
  return `${prefix}-${nextInt()}-${randomInt(1_000_000)}`;
}

function randomId(): number {
  return nextInt() * 100 + randomInt(100);
}

function randomCode(prefix: string): string {
  return `${prefix}_${randomInt(10_000)}`;
}

export function aRoleAssignmentV1(overrides: Partial<RoleAssignmentV1> = {}): RoleAssignmentV1 {
  return {
    id: randomId(),
    user_id: randomId(),
    role_code: randomCode("ROLE"),
    scope_code: randomCode("SCOPE"),
    scope_id: randomId(),
    status: "ACTIVE",
    ...overrides,
  };
}

export function aUserV1(overrides: Partial<UserV1> = {}): UserV1 {
  return {
    user_id: randomString("clerk"),
    email: `${randomString("user")}@example.com`,
    full_name: randomString("Full Name"),
    hub_user_id: randomId(),
    status: "ACTIVE",
    roles: [randomCode("ROLE")],
    assignments: [aRoleAssignmentV1()],
    ...overrides,
  };
}

export function aHubUserSummaryV1(overrides: Partial<HubUserSummaryV1> = {}): HubUserSummaryV1 {
  return {
    hub_user_id: randomId(),
    full_name: randomString("Full Name"),
    email: `${randomString("user")}@example.com`,
    status: "ACTIVE",
    role_code: randomCode("ROLE"),
    ...overrides,
  };
}

export function aRoleV1(overrides: Partial<RoleV1> = {}): RoleV1 {
  return {
    id: randomId(),
    role_code: randomCode("ROLE"),
    display_name: randomString("Role"),
    description: randomString("description"),
    future: false,
    status: "ACTIVE",
    ...overrides,
  };
}

export function aScopeTypeV1(overrides: Partial<ScopeTypeV1> = {}): ScopeTypeV1 {
  return {
    id: randomId(),
    scope_code: randomCode("SCOPE"),
    display_name: randomString("Scope"),
    description: randomString("description"),
    status: "ACTIVE",
    ...overrides,
  };
}

export function anAssignRoleRequestV1(
  overrides: Partial<AssignRoleRequestV1> = {}
): AssignRoleRequestV1 {
  return {
    role_code: randomCode("ROLE"),
    scope_code: randomCode("SCOPE"),
    scope_id: randomId(),
    ...overrides,
  };
}

export function aClientV1(overrides: Partial<ClientV1> = {}): ClientV1 {
  return {
    id: randomId(),
    name: randomString("Client"),
    agency_id: randomId(),
    status: "ACTIVE",
    ...overrides,
  };
}

export function aClientPageV1(overrides: Partial<ClientPageResponseV1> = {}): ClientPageResponseV1 {
  return {
    content: [aClientV1()],
    pageNumber: 1,
    pageSize: 20,
    totalElements: 1,
    totalPages: 1,
    ...overrides,
  };
}

export function anAgencyClientV1(overrides: Partial<AgencyClientV1> = {}): AgencyClientV1 {
  return {
    id: randomId(),
    name: randomString("Client"),
    ...overrides,
  };
}

export function anAgencyV1(overrides: Partial<AgencyV1> = {}): AgencyV1 {
  return {
    id: randomId(),
    name: randomString("Agency"),
    email: `${randomString("agency")}@example.com`,
    status: "ACTIVE",
    clientsCount: randomInt(50),
    ...overrides,
  };
}

export function anAgencyPageV1(overrides: Partial<AgencyPageResponseV1> = {}): AgencyPageResponseV1 {
  return {
    content: [anAgencyV1()],
    pageNumber: 1,
    pageSize: 20,
    totalElements: 1,
    totalPages: 1,
    ...overrides,
  };
}

export function aCampaignV1(overrides: Partial<CampaignV1> = {}): CampaignV1 {
  return {
    id: randomId(),
    name: randomString("Campaign"),
    client_id: randomId(),
    client_name: randomString("Client"),
    agency_id: randomId(),
    agency_name: randomString("Agency"),
    status: "Live",
    start_date: "2026-01-01",
    end_date: "2026-01-31",
    budget: randomId(),
    channels: ["Display"],
    industry_vertical: "Technology",
    ...overrides,
  };
}

export function anInsertionOrderLineItemV1(
  overrides: Partial<InsertionOrderLineItemV1> = {}
): InsertionOrderLineItemV1 {
  return {
    line_item_id: randomId(),
    description: randomString("Line item"),
    media_tactic: "Display",
    rate_type: "CPM",
    budget: randomId(),
    start_date: "2026-01-01",
    end_date: "2026-01-31",
    ...overrides,
  };
}

export function anInsertionOrderV1(overrides: Partial<InsertionOrderV1> = {}): InsertionOrderV1 {
  return {
    order_id: randomId(),
    order_number: `SO${randomId()}`,
    status: "Live",
    start_date: "2026-01-01",
    end_date: "2026-01-31",
    budget: randomId(),
    media_tactics: ["Display"],
    line_items: [anInsertionOrderLineItemV1()],
    ...overrides,
  };
}

export function aCampaignPageV1(overrides: Partial<CampaignPageResponseV1> = {}): CampaignPageResponseV1 {
  return {
    content: [aCampaignV1()],
    pageNumber: 1,
    pageSize: 16,
    totalElements: 1,
    totalPages: 1,
    ...overrides,
  };
}

export function aCampaignRefV1(overrides: Partial<CampaignRefV1> = {}): CampaignRefV1 {
  return {
    id: randomString("CAMP"),
    name: randomString("Campaign"),
    ...overrides,
  };
}

export function aPacingAlertV1(overrides: Partial<PacingAlertV1> = {}): PacingAlertV1 {
  return {
    type: "pacing_off_pace",
    severity: "warning",
    text: randomString("Pacing off pace"),
    ...overrides,
  };
}

export function aPacingRowV1(overrides: Partial<PacingRowV1> = {}): PacingRowV1 {
  return {
    id: randomString("pacing"),
    dashSlug: randomString("dash-slug"),
    name: randomString("Pacing"),
    status: "Live",
    ownerName: randomString("Owner"),
    flightStart: "2026-08-01",
    flightEnd: "2026-09-30",
    lineItemCount: 3,
    createdAt: "2026-07-15T09:30:00",
    campaigns: [aCampaignRefV1()],
    marginActualPct: 20,
    marginTargetPct: 25,
    pacingDeviationPct: 2,
    paceStatus: "on_pace",
    budgetTotal: 10000,
    alerts: [],
    ...overrides,
  };
}

export function aPacingScopeV1(overrides: Partial<PacingScopeV1> = {}): PacingScopeV1 {
  return {
    kind: "all",
    ids: [],
    // Wire field is `can_create` (PacingScopeV1) - TypeScript never catches a typo of this here
    // because `src/test/**` is excluded from the project's tsc build (see tsconfig.json), so a
    // wrong key silently carries no `can_create` at all rather than failing to compile.
    can_create: false,
    ...overrides,
  };
}

export function aPacingListResponseV1(overrides: Partial<PacingListResponseV1> = {}): PacingListResponseV1 {
  return {
    scope: aPacingScopeV1(),
    pacings: [aPacingRowV1()],
    ...overrides,
  };
}

export function aPacingNsDiffCountsV1(overrides: Partial<PacingNsDiffCountsV1> = {}): PacingNsDiffCountsV1 {
  return {
    missingInNetsuite: 0,
    missingInPacing: 0,
    fieldDiff: 0,
    planDiff: 0,
    foreignCampaign: 0,
    ownerDiff: 0,
    ...overrides,
  };
}

export function aPacingNsDiffSummaryV1(overrides: Partial<PacingNsDiffSummaryV1> = {}): PacingNsDiffSummaryV1 {
  return {
    counts: aPacingNsDiffCountsV1(),
    inSync: true,
    computedAt: "2026-09-20T03:00:00Z",
    ...overrides,
  };
}

export function aPacingNsDiffMissingInNetsuiteV1(
  overrides: Partial<PacingNsDiffMissingInNetsuiteV1> = {}
): PacingNsDiffMissingInNetsuiteV1 {
  return {
    lineItemId: randomString("li"),
    channel: "Display",
    targetSpend: 5000,
    targetImpressions: 100000,
    ...overrides,
  };
}

export function aPacingNsDiffMissingInPacingV1(
  overrides: Partial<PacingNsDiffMissingInPacingV1> = {}
): PacingNsDiffMissingInPacingV1 {
  return {
    lineItemId: randomString("li"),
    campaignId: randomString("CAMP"),
    campaignName: randomString("Campaign"),
    orderNumber: randomString("IO"),
    channel: "Display",
    rateType: "CPM",
    nativeBudget: 4000,
    plannedUnits: 80000,
    flightStart: "2026-08-01",
    flightEnd: "2026-09-30",
    description: randomString("Line item"),
    ...overrides,
  };
}

export function aPacingNsDiffCoveredByV1(overrides: Partial<PacingNsDiffCoveredByV1> = {}): PacingNsDiffCoveredByV1 {
  return {
    pacingId: randomString("pacing"),
    pacingName: randomString("Pacing"),
    dashSlug: randomString("dash-slug"),
    status: "Live",
    ...overrides,
  };
}

export function aPacingNsDiffForeignCampaignV1(
  overrides: Partial<PacingNsDiffForeignCampaignV1> = {}
): PacingNsDiffForeignCampaignV1 {
  return {
    lineItemId: randomString("li"),
    pacingCampaignId: randomString("CAMP"),
    netsuiteCampaignId: randomString("CAMP"),
    netsuiteCampaignName: randomString("Campaign"),
    inPacingCampaignSet: false,
    ...overrides,
  };
}

export function aPacingNsDiffOwnerMismatchV1(
  overrides: Partial<PacingNsDiffOwnerMismatchV1> = {}
): PacingNsDiffOwnerMismatchV1 {
  return {
    campaignId: randomString("CAMP"),
    campaignName: randomString("Campaign"),
    ownerName: randomString("Owner"),
    mpoTeamLead: randomString("Lead"),
    ...overrides,
  };
}

export function aPacingNsDiffReportV1(overrides: Partial<PacingNsDiffReportV1> = {}): PacingNsDiffReportV1 {
  return {
    pacingId: randomString("pacing"),
    dashSlug: randomString("dash-slug"),
    counts: aPacingNsDiffCountsV1(),
    inSync: true,
    missingInNetsuite: [],
    missingInPacing: [],
    fieldDiff: [],
    planDiff: [],
    foreignCampaign: [],
    ownerDiff: [],
    ...overrides,
  };
}

export function aPacingDashboardCampaignV1(
  overrides: Partial<PacingDashboardCampaignV1> = {}
): PacingDashboardCampaignV1 {
  return {
    slug: randomString("dash-slug"),
    pacingId: randomString("pacing"),
    name: randomString("Campaign"),
    startDate: "2026-08-01",
    endDate: "2026-09-30",
    currency: "USD",
    status: "Live",
    orderNumber: randomString("SO"),
    ...overrides,
  };
}

export function aPacingLineItemPlanV1(overrides: Partial<PacingLineItemPlanV1> = {}): PacingLineItemPlanV1 {
  return {
    lineItemId: randomString("li"),
    channel: "Display",
    dsp: "DV360",
    rateType: "CPM",
    clientBudget: 10_000,
    plannedImpressions: 1_000_000,
    marginTargetPct: 20,
    ctrTargetPct: 0.1,
    vcrTargetPct: null,
    flightStart: "2026-08-01",
    flightEnd: "2026-09-30",
    pauseIntervals: [],
    containers: [],
    ...overrides,
  };
}

export function aPacingJournalEntryV1(overrides: Partial<PacingJournalEntryV1> = {}): PacingJournalEntryV1 {
  return {
    id: randomString("journal"),
    ts: "2026-08-05",
    msg: randomString("Note"),
    uid: "azat@aidigital.com",
    editedAt: null,
    ...overrides,
  };
}

export function aPacingDashboardV1(overrides: Partial<PacingDashboardV1> = {}): PacingDashboardV1 {
  const plan = aPacingLineItemPlanV1();
  return {
    campaign: aPacingDashboardCampaignV1(),
    planByLineItem: { [plan.lineItemId]: plan },
    factsDaily: [],
    asOf: "2026-08-15",
    display: { rev: 1, widgets: [] },
    aggregate: {},
    libraryEntries: undefined,
    journal: [],
    ...overrides,
  };
}

/** §14 - the 13 detectors at their documented defaults, master switch on (tests usually care whether
 *  a save reaches Pacing, not whether the master switch happens to be off). */
export function aPacingAlertsConfigV1(overrides: Partial<PacingAlertsConfigV1> = {}): PacingAlertsConfigV1 {
  return {
    enabled: true,
    bidFactAbovePlan: { enabled: true, slack: true, window: 2, thresholdPct: 5 },
    dataGap: { enabled: true, slack: true, gapDays: 1 },
    ctrBelowTarget: { enabled: true, slack: true, factor: 0.7 },
    vcrBelowTarget: { enabled: true, slack: true, factor: 0.7 },
    ctrAboveTarget: { enabled: true, slack: true, factor: 2.0 },
    vcrOver100: { enabled: true, slack: true },
    noImpressionsYet: { enabled: true, slack: true },
    pacingOffPace: { enabled: true, slack: true, low: -5, high: 5 },
    marginBelowTarget: { enabled: true, slack: true, gapPp: 3 },
    spendOverspend: { enabled: true, slack: true, warnPct: 90, badPct: 100 },
    dspForecastOverspend: { enabled: true, slack: true },
    staleData: { enabled: true, slack: true, days: 2 },
    rateCostAbovePlan: { enabled: true, slack: true, thresholdPct: 10 },
    ...overrides,
  };
}

export function aPacingNotifySettingsV1(overrides: Partial<PacingNotifySettingsV1> = {}): PacingNotifySettingsV1 {
  return {
    alerts: aPacingAlertsConfigV1(),
    metrics: { vcr: false },
    hidePaused: false,
    summaryProjection: "reforecast",
    ...overrides,
  };
}

export function aPacingRefreshStatusV1(overrides: Partial<PacingRefreshStatusV1> = {}): PacingRefreshStatusV1 {
  return {
    exists: true,
    refreshId: randomString("refresh"),
    rowCount: 120,
    latestDate: "2026-08-14",
    ...overrides,
  };
}

export function aPacingDraftLineItemV1(overrides: Partial<PacingDraftLineItemV1> = {}): PacingDraftLineItemV1 {
  return {
    lineItemId: randomString("li"),
    channel: "DOOH",
    flightStart: "2026-03-01",
    flightEnd: "2026-03-31",
    rateType: "CPM",
    description: randomString("Line item"),
    nativeBudget: 20633.4,
    budgetTotal: 20633.4,
    currency: "USD",
    exchangeRate: 1,
    converted: false,
    plannedUnits: 1432875,
    targetImpressions: 1432875,
    marginPercent: 15.5,
    targetCtr: 0.85,
    targetVcr: undefined,
    campaignId: randomString("campaign"),
    campaignName: randomString("Campaign"),
    orderNumber: "TM-271064",
    ...overrides,
  };
}

export function aPacingInsertionOrderV1(overrides: Partial<PacingInsertionOrderV1> = {}): PacingInsertionOrderV1 {
  return {
    orderId: randomString("order"),
    orderNumber: "TM-271064",
    orderName: undefined,
    orderBudget: 250000,
    orderStartDate: "2026-01-01",
    orderEndDate: "2026-03-31",
    orderStatus: "Active",
    ...overrides,
  };
}

export function aPacingDraftV1(overrides: Partial<PacingDraftV1> = {}): PacingDraftV1 {
  return {
    ok: true,
    client: randomString("Client"),
    agency: randomString("Agency"),
    campaign: randomString("Campaign"),
    orderNumber: "TM-271064",
    orderNumbers: ["TM-271064"],
    lineItems: [aPacingDraftLineItemV1()],
    insertionOrders: [aPacingInsertionOrderV1()],
    notFoundIds: [],
    warnings: [],
    inUse: {},
    ...overrides,
  };
}

export function aPacingCreateResultV1(overrides: Partial<PacingCreateResultV1> = {}): PacingCreateResultV1 {
  return {
    pacingId: randomString("pacing"),
    dashSlug: randomString("dash-slug"),
    ...overrides,
  };
}

export function aPacingLibraryEntryV1(overrides: Partial<PacingLibraryEntryV1> = {}): PacingLibraryEntryV1 {
  return {
    id: randomString("entry"),
    kind: "widget",
    name: randomString("Widget"),
    description: null,
    definition: { id: "w_seed0001", kind: "composite", schemaVersion: 2 },
    ownerName: "Azat Nabiev",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-02T00:00:00Z",
    likes: 0,
    liked: false,
    mine: true,
    usage: 0,
    ...overrides,
  };
}
