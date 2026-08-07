# AIAE Operational Hub

AI Digital Operational Hub is an internal operations and reporting application for agency teams. It lets authenticated AI Digital users browse agencies, clients, campaigns, insertion orders, reporting rows, conversions, saved report views, and role/team access built from NetSuite/Rippling data and BigQuery reporting marts.

The product is intentionally operational rather than marketing-facing: it is a workbench for media operations, team visibility, manual report adjustments, Excel round trips, and admin-controlled access.

## What It Does

| Area | Business purpose | Primary data source |
| --- | --- | --- |
| Agencies / clients / campaigns | Browse the commercial hierarchy available to the current user. | BigQuery IO Lines table, default `silken-quasar-376417.netsuite.netsuite_campaigns_with_ids_fresh_data`. |
| Campaign workspace | Inspect a campaign's setup, pacing, reporting, and dashboard views. | BigQuery campaign/search services plus frontend campaign tabs. |
| Reporting rows | Show delivery metrics, derived KPIs, totals, filters, sorting, grouping, saved views, and Excel exports. | `platform_mart_adjustments_view_op_hub` plus conversions joined from `conversions_mart_adjustments_view_op_hub`. |
| Manual adjustments | Let users edit delivery metrics and conversion values through UI or `.xlsx` upload/download flows. | Hub writes BigQuery adjustment tables; BigQuery views merge them back into readable marts. |
| Users, roles, teams | Control campaign visibility and admin access. | Clerk for login, PostgreSQL for Hub users/RBAC, BigQuery Rippling + agency lead tables for sync. |
| NetSuite/Rippling sync | Build teams, team leads, grades, role assignments, and agency-to-team visibility. | BigQuery employee and agency lead extracts reconciled into PostgreSQL. |

## Tech Stack

| Layer | Stack |
| --- | --- |
| Backend | Java 21, Spring Boot 3.5, Maven multi-module, PostgreSQL, Liquibase, Hibernate/JPA, MapStruct, Apache POI. |
| Frontend | React 18, TypeScript, Vite, React Router, TanStack Query, Clerk, `openapi-fetch`, plain CSS/BEM. |
| External services | Clerk JWT auth, Google BigQuery read/write clients. |
| API contract | OpenAPI spec at `backend/application/src/main/resources/api/v1/specs/openapi.yaml`; frontend types are generated into `frontend/src/shared/api/generated/schema.d.ts`. |
| Testing | JUnit 5, Mockito, Instancio, embedded Postgres, Vitest + Testing Library. |

## Repository Layout

| Path | Purpose |
| --- | --- |
| `backend/application` | Spring Boot app, OpenAPI controllers, web/security/config, XLSX assemblers, schedulers. |
| `backend/service` | Business services: agency search/reporting, RBAC, NetSuite sync, BigQuery SQL builders. |
| `backend/domain` | JPA entities and repositories. |
| `backend/db` | Liquibase schema/data changelogs. |
| `backend/external-services` | BigQuery clients and external configuration. |
| `backend/cache-management` | Cache invalidation support. |
| `backend/report-aggregate` | Aggregated backend packaging module. |
| `frontend/src/features` | Product features: agencies, clients, campaigns, reporting tabs, RBAC/team management. |
| `frontend/src/shared` | Shared API client, auth helpers, UI primitives, formatting, config. |
| `scripts` | Local/Replit build and run wrappers. |

## Backend Modules

| Module | Depends on | Notes |
| --- | --- | --- |
| `db` | none | Liquibase migrations and seed data. |
| `domain` | `db` concepts | JPA entities/repositories for Hub-owned state. |
| `external-services` | none | BigQuery read/write adapters and config. |
| `service` | `domain`, `external-services`, `cache-management` | Business logic, RBAC, search, report rows, sync reconciliation. |
| `application` | all backend modules | HTTP boundary, OpenAPI implementation, security, schedulers, static frontend serving. |

## Main API Areas

| API area | Representative endpoints | Owner |
| --- | --- | --- |
| Auth | `GET /api/v1/auth/me` | `AuthController` |
| Dictionaries | `/api/v1/dictionary/rbac/*`, `/api/v1/dictionary/statuses` | `DictionaryController` |
| RBAC users | `/api/v1/rbac/users/search`, `/api/v1/rbac/users/{userId}/role-assignments` | `RbacController` |
| Agency hierarchy | `/api/v1/agencies/search`, `/api/v1/clients/search`, `/api/v1/campaigns/search` | Agency/client/campaign controllers |
| Campaign reporting | `/api/v1/campaigns/{campaignId}/report-rows`, `/export`, `/distinct-values` | `CampaignController` |
| Delivery adjustments | `/api/v1/campaigns/{campaignId}/report-rows/adjustments`, `/template`, `/upload` | `CampaignController` |
| Conversion adjustments | `/api/v1/campaigns/{campaignId}/conversions/*` | `CampaignController` |
| Report views | `/api/v1/campaigns/{campaignId}/report-views/*` | `CampaignController` |
| Teams | `/api/v1/teams`, `/api/v1/teams/search`, `/api/v1/teams/{teamId}` | `TeamController` |
| Sync | `POST /api/v1/sync` | `SyncController` |

## Users, Roles, And Visibility

| Concept | Source of truth | How it maps |
| --- | --- | --- |
| Authentication | Clerk | Backend validates Clerk JWTs and accepts users from `AUTH_ALLOWED_EMAIL_DOMAIN` only. |
| First login | Clerk JWT claims | `hub_users` row is auto-provisioned from Clerk user id, email, and name. New users are active but have no access roles. |
| Admin access | PostgreSQL `hub_role_assignments` | `ADMIN` grants full visibility and RBAC/team management. NetSuite sync preserves existing admin assignments. |
| Team visibility | PostgreSQL `hub_teams`, `hub_team_agencies`, role assignments | Team-scoped roles see agencies linked to their team. |
| Own/team roles | NetSuite/Rippling sync | Employees are classified by title and manager chain, then reconciled into Hub roles and team assignments. |

Seeded roles and scopes:

| Role code | Display name | Current use |
| --- | --- | --- |
| `ADMIN` | Administrator | Full visibility and admin UI. Preserved during sync. |
| `MPO_MANAGER` | MPO Manager | Member-level operational role. |
| `TL` | Team Lead | Team lead role. |
| `DIRECTOR` | Director | Director-level role. |
| `CLIENT_SERVICES` | Client Services | Seeded as a future role. |

| Scope code | Meaning | Assignable |
| --- | --- | --- |
| `OWN` | User's own `hub_users.id`. | Yes |
| `TEAM` | A `hub_teams.id`. | Yes |
| `ALL` | Global scope, no `scope_id`. | Yes |
| `AGENCY` | Agency scope. | Seeded, not assignable yet |
| `CLIENT` | Client scope. | Seeded, not assignable yet |

## NetSuite / Rippling Sync Mapping

The sync reads active employees and agency lead rows from BigQuery, resolves org structure in memory, then reconciles Hub users, teams, role assignments, and team-agency mappings inside transactional service logic.

| Input | Rule |
| --- | --- |
| Employee identity | Deduplicated by `work_email`; rows without work email are ignored. |
| Title | Classified by title markers: senior director/director/team lead/trainee/senior manager/junior manager/manager. Unknown titles become member + `UNKNOWN` grade and are flagged. |
| Manager chain | Members walk the `manager` display-name chain until the nearest Team Lead. Directors do not get a team. Team Leads lead their own team. |
| Rippling `teams` string | Parsed into pod tokens (`HOUSE`, `EAST`, `WEST`, etc.), grade cohorts, team lead fragments (`Department: FirstName`), and noise. Used as cross-check and fallback, not as the primary tree. |
| Team name | Built as `<department leaf>: <team lead first name>`, for example `Media Optimization: Galina`. Duplicate names are disambiguated with the email local part and flagged. |
| Pod | Team Lead's own pod token wins when unique; otherwise the majority member pod is used. Ambiguity is flagged. |
| Agency mapping | Agency lead rows connect `mpo_team_lead` to resolved Team Leads, then agencies are assigned to the corresponding Hub team. |
| Admin preservation | If a Hub user already has an active `ADMIN` assignment, sync does not downgrade or replace that role. |

## User -> Team -> Agency Mapping Algorithm

The Hub does not trust a single source column as "the team". It builds the mapping from employees, their manager chain, and agency lead ownership, then stores the result in Hub-owned RBAC tables.

| Step | Input | Output | Notes |
| --- | --- | --- | --- |
| 1. Load employees | BigQuery Rippling employees table | Active employee list | Rows are deduplicated by `work_email`; employees without work email are skipped. |
| 2. Classify each employee | `title` | `OrgRole` + `Grade` | Team Lead, Director, Senior/Middle/Junior/etc. are inferred from title text. Unknown titles are flagged. |
| 3. Resolve each member's Team Lead | `manager` chain | `teamLeadEmail` per employee | The primary path walks manager names upward until the nearest employee classified as Team Lead. Directors terminate the chain. |
| 4. Cross-check/fallback with `teams` | Rippling `teams` string | Data-quality flags, optional fallback Team Lead | Tokens like `Media Optimization: Galina` are parsed. They can resolve a Team Lead only when the manager chain cannot, and only on a unique first-name match. |
| 5. Build Hub teams | Team Lead employee rows | `hub_teams` rows | Team name is `<department leaf>: <team lead first name>`, e.g. `Media Optimization: Galina`. Duplicate names are disambiguated and flagged. |
| 6. Assign user role/scope | Resolved employee role + team | `hub_role_assignments` | Members get their operational role/scope; Team Leads get team-scoped access; Directors/Admins get broader access per RBAC rules. Existing Admin assignments are preserved. |
| 7. Load agency ownership | BigQuery IO Lines / agency lead rows | `agencyId -> mpo_team_lead` candidates | Agency rows carry names such as growth director, client service manager, and `mpo_team_lead`. |
| 8. Match agency to Team Lead | `mpo_team_lead` display name | Team Lead user/team | The name is matched to a synced Team Lead. Unresolved names are logged as data-quality issues. |
| 9. Link team to agency | Resolved team + agency id | `hub_team_agencies` | This is the final visibility bridge: users with team scope see agencies linked to their team. |

Resulting runtime path:

| Runtime question | Answered by |
| --- | --- |
| Who is this logged-in user? | Clerk JWT -> `hub_users`. |
| What role does the user have? | Active rows in `hub_role_assignments`. |
| Which team is the user in? | Team-scoped assignment built by sync from the resolved Team Lead. |
| Which agencies can the team see? | `hub_team_agencies` rows created from `mpo_team_lead` agency ownership. |
| Which campaigns can the user see? | BigQuery campaign search filtered by the user's agency visibility. |

## BigQuery Sources And Write Targets

| Property | Default table/view | Used for |
| --- | --- | --- |
| `BIGQUERY_IO_LINES_TABLE` | `silken-quasar-376417.netsuite.netsuite_campaigns_with_ids_fresh_data` | Agencies, clients, campaigns, insertion orders. |
| `BIGQUERY_RIPPLING_EMPLOYEES_TABLE` | `silken-quasar-376417.custom_task_data.rippling_employees` | Employee org tree sync. |
| `BIGQUERY_ADJUSTMENTS_VIEW` | `silken-quasar-376417.operational_hub.platform_mart_adjustments_view_op_hub` | Delivery/report rows with delivery adjustments merged in. |
| `BIGQUERY_ADJUSTMENTS_TABLE` | `silken-quasar-376417.operational_hub.platform_mart_operational_hub_adjustements` | Hub delivery adjustment writes. |
| `BIGQUERY_CONVERSIONS_VIEW` | `silken-quasar-376417.operational_hub.conversions_mart_adjustments_view_op_hub` | Conversion rows, conversion breakdown, and report-row conversion totals. |
| `BIGQUERY_CONVERSIONS_TABLE` | `silken-quasar-376417.operational_hub.conversions_mart_operational_hub_adjustments` | Hub conversion adjustment writes. |

## Report Row Mapping

Report rows are built from the delivery adjustments view, scoped by the visible campaign. Conversions are not taken from the delivery mart's conversion columns: they are joined from the conversions view so the Hub matches the report-builder behavior.

| Field group | BigQuery source columns | Hub behavior |
| --- | --- | --- |
| Row identity | `date`, `platform`, `account`, `account_id`, `constructed_name/id`, `constructed_name/id_lvl2`, `constructed_name/id_lvl3` | Required key for editing an existing delivery row. |
| Naming convention dimensions | `CNB_agency_id`, `CNB_client`, `CNB_industry_code`, `CNB_campaign_name`, `CNB_channel`, `CNB_tactic`, `CNB_buying_model`, `CNB_audience`, `CNB_unique_line_item_id`, `CNB_other`, `CNB_geo`, `CNB_creative_tag`, `CNB_message`, `CNB_keyword_group`, `CNB_flight_identifier`, `CNB_language` | Displayed/filterable dimensions; new manual rows derive CNB values from the constructed name. |
| Delivery metrics | `impressions`, `clicks`, `spend`, `starts`, quartiles, `completes`, `dynamic_cost`, `link_clicks` | Summed for totals/grouped reads. `dynamic_cost` is the report cost basis. |
| Derived metrics | `CPM`, `CPC`, `CPV`, `IVT`, `CTR`, `AVCR`, dynamic rate | Computed in SQL with channel/buying-model gates, then recomputed from summed components for grouped rows. |
| Conversions | `conversions_mart_adjustments_view_op_hub.conversions` | Aggregated by date + level 1 + level 3, joined to delivery rows, and gated to one row for campaign-level channels. |
| Adjustment metadata | `adjusted_metrics`, audit timestamps/users | Delivery and conversion `adjusted_metrics` are merged. Audit fields prefer conversion metadata when conversion adjustment is the visible row change, otherwise delivery metadata. |

Constructed levels are platform-dependent. The frontend resolves display labels from the platform in view:

| Platform family | Level 1 | Level 2 | Level 3 |
| --- | --- | --- | --- |
| DV360, Xandr, Yahoo, Beeswax | Line item | Insertion order | Creative |
| TTD, LinkedIn | Ad set | Campaign | Creative |
| Meta, TikTok | Ad set | Campaign | Ad |
| Google Ads, Spotify, Microsoft | Campaign | Ad set | Ad |
| Vistar, Viant | Campaign | Insertion order | Creative |
| Amazon, ADT | Insertion order | Line item | Creative |

## Conversions Mapping

Conversions have their own grain: one row per date, identity, conversion action, and conversion category. The reporting table hides conversion action, so actions are summed before the value is attached back to delivery rows.

| Rule | Behavior |
| --- | --- |
| Campaign scope | Conversion rows are filtered by `CNB_campaign_name` and `CNB_client` from the resolved campaign. |
| Join keys | Date + normalized level-1 name + level-3 name. For Google Search, Google SEM, and YouTube, level 3 is intentionally ignored because conversions are campaign-level. |
| Campaign-level channels | Google Search, Google SEM, and YouTube receive the conversion total only on the highest-impression row for that date/campaign to avoid multiplying the total across creatives. |
| Google Ads all conversions | SQL supports the report-builder distinction between `conversions` and `all_conversions`; current report rows use the primary conversions path unless the caller opts into the all-conversions expression. |
| Conversion adjustments | Upload/template flow compares rows by the conversions natural key and writes replacements under a cross-node `conversion_adjustments` lock. |
| Missing base conversion rows | The BigQuery view can expose adjustment-only rows; these read as `Non-existent data` in `adjusted_metrics`. |

## Saved Report Views

Saved report views live in PostgreSQL table `hub_report_views`.

| Stored field | Meaning |
| --- | --- |
| `campaign_id` + `name` | Unique saved view name per campaign. |
| `dimensions` | Selected report dimensions. |
| `metrics` | Selected report metrics. |
| `filters` | Saved report filters, including date ranges. |
| `type`, `status`, `note` | View metadata for UI workflows. |

## Frontend Routes

| Route | Screen |
| --- | --- |
| `/` | Overview |
| `/agencies` | Agency list |
| `/agencies/:agencyId` | Clients for an agency |
| `/clients/:clientId` | Campaigns for a client |
| `/campaigns/:campaignId/pacing` | Campaign pacing tab |
| `/campaigns/:campaignId/setup` | Campaign setup / insertion orders |
| `/campaigns/:campaignId/reporting` | Reporting rows, adjustments, exports, saved report views |
| `/campaigns/:campaignId/dashboards` | Dashboard tab |
| `/teams` | Admin-only team and user management |

## Local Development

Prerequisites:

- Java 21
- Maven
- Node.js/npm
- PostgreSQL
- Clerk app credentials
- BigQuery credentials if running against real data

Useful commands:

```bash
# From repository root: backend
cd backend
JAVA_HOME=$(/usr/libexec/java_home -v 21) mvn -q -pl application -am test
```

```bash
# From repository root: frontend
cd frontend
npm install
npm test
npm run typecheck
```

```bash
# From repository root: wrapper scripts
bash scripts/replit-dev-backend.sh
bash scripts/replit-dev-frontend.sh
bash scripts/local-verify.sh
```

The frontend generates API types from the backend OpenAPI spec:

```bash
cd frontend
npm run generate:api
```

## Environment

| Variable | Purpose |
| --- | --- |
| `PORT` | Backend port, default `5000`. |
| `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | PostgreSQL connection for normal profiles. |
| `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` | Replit PostgreSQL variables, mapped in the Replit profile/scripts. |
| `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY` | Clerk frontend/backend publishable keys. |
| `AUTH_ALLOWED_EMAIL_DOMAIN` | Allowed login email domain, default `aidigital.com`. |
| `AUTH_AUTHORIZED_PARTIES` | Allowed JWT authorized parties/frontend origins. |
| `AUTH_ISSUER_URI`, `AUTH_JWKS_URI`, `AUTH_AUDIENCE` | Clerk JWT verification settings. |
| `BIGQUERY_ENABLED`, `BIGQUERY_STUB_ENABLED` | Real BigQuery client vs stub mode. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Inline Google service account JSON. |
| `BIGQUERY_PROJECT_ID`, `BIGQUERY_DATASET`, `BIGQUERY_LOCATION` | BigQuery job and dataset settings. |
| `BIGQUERY_*_TABLE`, `BIGQUERY_*_VIEW` | Override specific BigQuery sources and write targets. |

See `.env.example` for a starter local environment file.

## Verification

Common checks used for this repository:

```bash
cd backend
JAVA_HOME=$(/usr/libexec/java_home -v 21) mvn -q -pl service -Djacoco.skip=true test
JAVA_HOME=$(/usr/libexec/java_home -v 21) mvn -q -pl application -am -Djacoco.skip=true test

cd ../frontend
npm test
npm run typecheck
```

The backend build runs Checkstyle during Maven `validate`. Generated OpenAPI sources should not be edited manually; update `openapi.yaml`, regenerate, and then update callers.
