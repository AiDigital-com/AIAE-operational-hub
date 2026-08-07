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
