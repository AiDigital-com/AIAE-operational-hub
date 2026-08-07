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
- Frontend styles follow BEM and semantic CSS tokens; do not introduce Tailwind, CSS Modules, styled-components, Emotion, or CSS-in-JS.
- Frontend tests follow the project style from `.claude/rules/50-frontend-tests.md`.
