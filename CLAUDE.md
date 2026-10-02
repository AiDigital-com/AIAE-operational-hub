# CLAUDE.md

This file provides reusable engineering guidance to Claude Code. Apply it to
the current repository after discovering that repository's actual structure,
package root, build commands, ports, and existing product decisions.

## Project Overview

The default supported architecture is a Spring Boot backend and a React
frontend. Preserve an existing project's established stack and layout unless
the user explicitly requests a migration.

Common top-level areas:

- `backend/` — Java 21, Spring Boot 3.5, multi-module Maven backend
- `frontend/` — React + TypeScript + Vite frontend
- `.claude/` — self-contained Claude rules, docs, skills, and task artifacts for this repository

## Start Here

1. Read `.claude/agent_docs/index.md`.
2. For backend work, read the relevant docs before changing code:
   - `project_structure.md`
   - `building_the_project.md`
   - `running_tests.md`
   - `code_conventions.md`
   - `database_schema.md`
   - `service_architecture.md`
3. For frontend work, read the relevant docs before changing code:
   - `project_structure.md`
   - `building_the_project.md`
   - `running_tests.md`
   - `frontend_architecture.md`
   - `frontend_style.md`
   - `frontend_testing.md`
4. Respect `.claude/rules/*.md`.
5. Read `.claude/agent_docs/skill-selection.md` before choosing between GSD,
   `task-workflow`, and a focused skill.
6. Before applying a path, package, port, module, navigation, or test command
   from these docs, verify it against the current repository.

## Enterprise Hard Constraints

- Keep the rule set self-contained when it is installed into a project; do not
  depend on another local checkout or a machine-specific absolute path.
- Do not hand-edit generated backend OpenAPI sources or generated frontend OpenAPI types.
- Do not add dependencies casually. Use the existing stack and local patterns first.
- Keep secrets out of frontend code and public environment variables.
- Never replace an established product flow, navigation model, or visual system
  with a template default unless the user explicitly asks for that change.

## Backend Hard Constraints

- Backend stack is fixed: Java 21, Spring Boot 3.x, Maven multi-module, PostgreSQL, Liquibase.
- Discover and preserve the repository's single production package root; do not
  introduce a second root or placeholder packages.
- Backend controllers implement generated OpenAPI interfaces and stay thin.
- Backend JPA repositories are accessed only through their paired entity service.
- Backend tests follow the project style from `.claude/rules/20-tests.md`.

## Frontend Hard Constraints

- Frontend stack is fixed: React, TypeScript, Vite, TanStack Query, Clerk, `openapi-fetch`, plain CSS with BEM.
- Frontend API calls go through the generated OpenAPI client boundary under `frontend/src/shared/api`.
- Preserve the product's established navigation model. For a new project with
  no explicit design, follow the installed frontend design guidance.
- Frontend styles follow BEM and semantic CSS tokens; do not introduce Tailwind, CSS Modules, styled-components, Emotion, or CSS-in-JS. The one exception is already made and must not be widened: `features/pacing-dashboard/spa/tailwind-subset.css` writes out, by hand, the ~140 Tailwind utility classes the MOVED Pacing markup asks for by name (`text-11`, `mt-1`, `truncate`). It exists so that markup is not re-typed, it is a plain stylesheet with no build step, and Tailwind itself stays out — its preflight would reset every element in this app. Do not reach for those class names in code you write here.
- Frontend tests follow the project style from `.claude/rules/50-frontend-tests.md`.
- **`frontend/src/features/pacing-dashboard/engine/vendor/` is not ours to edit.** Those six files
  are byte-identical copies of Pacing's calculation engine, taken from the `AIAE-paicing`
  repository, so this app computes filtered dashboard figures with the same implementation that
  service runs rather than a second version of the maths. No reformatting, no TypeScript
  conversion, no lint fixes, no small improvements — read `engine/vendor/SOURCE.md` before going
  near them. Nothing automated compares the two copies, in either repository; a stale copy passes
  every test here, including the crown test.

## The Pacing dashboard is moved code, not written code

`features/pacing-dashboard/` is the one place in this app that is mostly not ours. Three different
kinds of file live there, and they are not interchangeable:

- `engine/vendor/` — six byte-identical copies of Pacing's calculation engine. See the constraint
  above and `engine/vendor/SOURCE.md`.
- `spa/` — the Pacing SPA's widget renderer, widget builder, `ui/` kit and third-party screens,
  MOVED here from `AIAE-paicing/workspace/src` (185 files; the few beside them — `store.js`,
  `pacing-spa.css`, `tailwind-subset.css`, `SOURCE.md` — are this app's own seam). Plain JavaScript,
  typed by inference under `allowJs`. Read `spa/SOURCE.md` first. Treat a change here the way you
  would treat a change to a dependency: if the fix belongs upstream, make it in
  `AIAE-paicing/workspace/` and bring it over, and SAY SO in your report — nothing compares the two
  copies.
- `vendor/` — UMD modules from Pacing's `shared/`, loaded through `vendor/umd-plugin.ts` (Vite's
  `optimizeDeps` only covers `node_modules` and `build.commonjsOptions` is Rollup-only, so the dev
  server needs the plugin). The `@shared/*` aliases are listed module-by-module in `vite.config.ts`
  and `vitest.config.ts`.

Ours, and ordinary TypeScript: `pacing-dashboard.tsx`, `widgets/report-board.tsx` (the 12-column
grid, running Pacing's own `resolveLayout`/`compactVertical`/`groupBounds`), `widgets/tile-menu.tsx`
(this app's kebab, not Pacing's bordered one), `widget-editor.tsx`, `pacing-dashboard-library.tsx`,
the settings drawer, the journal.

### What bit us, so it does not bite you twice

- **`spa/pacing-spa.css` was extracted by scanning `class="..."` literals**, so everything composed
  at runtime was missed: `.cmp-row` (its column count is written in a template string), the chart
  tick size (`fontSize: 'var(--text-10)'` on an SVG attribute), `var(--pal-${i})`. The symptom never
  reads as "missing stylesheet" — an undefined custom property makes the whole declaration invalid
  and the element silently inherits something else. A section widget rendered three times its height
  and the charts rendered 60% too large. **Check against the live DOM, not the source**: collect the
  page's classes and the `var(--…)` names the moved JS uses, and diff them against what is declared.
- **Pacing is a Tailwind app and this one is not** — see the constraint above.
- **The theme is this app's.** `spa/pacing-spa.css` defines only tokens `app/tokens.css` does not
  have, and answers to `[data-theme="dark"]` rather than Pacing's `.dark`. Four shared tokens
  (`--surface`, `--text-muted`, `--shadow-card`, `--shadow-pop`) are deliberately NOT redefined: this
  app's values win, so a moved component picks up this app's surface. Where that looks wrong the fix
  is a rule, never a token redefinition that would move the rest of the Hub with it.

### Owner decisions on this screen

- **The KPI strip is gone (2026-10-01).** Pace / Margin / Budget / Spend to date used to sit above
  the filter bar. It had no counterpart in Pacing, and it disagreed in public with the widget right
  below it: on a Complete pacing it printed "No data" and a dash while the hero widget computed
  92.90% margin from the same facts, and its CPM was the cost-side one next to Finance's client-side
  CPM, neither labelled. `pacing-dashboard-health.ts` went with it. Do not reintroduce it.
- **The sections cutover is not adopted**, on either side. Pacing's `shared/dash-blocks.js` and
  `std-entries.js` are deliberately pre-cutover, because adopting it needs a data migration on
  `access.pacings` and there is no fresh production dump to rehearse on. The full reasoning is in
  `AIAE-paicing/CLAUDE.md`, "Twelve SPA suites are red on purpose".
