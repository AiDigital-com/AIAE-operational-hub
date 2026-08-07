# GSD And Skill Selection

Use the lightest workflow that gives the task enough control. Do not nest the
full `task-workflow` inside a GSD phase.

## Decision path

| Situation | Recommended path |
|---|---|
| Small, well-scoped change | Implement directly, run the relevant review skill, then `verification-gate` |
| One bounded feature needing plan/review/test artifacts | `task-workflow` |
| Multi-phase feature, migration, uncertain architecture, or work spanning sessions | GSD: discuss -> plan -> execute -> verify -> ship |
| Debugging an unclear failure | GSD `debug`/`systematic` flow; use specialized review after the fix |
| Read-only backend review | `backend-rule-review` |
| Read-only frontend/UI review | `frontend-style-review` |
| Whole-repository compliance/handoff | `rule-compliance-audit` |
| UI creation, parity, or visual polish | `ui-designer`, then `frontend-style-review` |
| Final evidence outside GSD | `verification-gate` |

## Installed project skills

- `task-workflow`: sequential analyst -> developer -> reviewer -> tester loop for
  one bounded task. Produces artifacts under `.claude/tasks/<task>/`.
- `backend-rule-review`: high-confidence Java/Spring correctness and compliance
  review against architecture, OpenAPI, persistence, typing, and test rules.
- `frontend-style-review`: frontend behavior, visual, accessibility, network, and
  rule-compliance review.
- `rule-compliance-audit`: evidence matrix across the full installed engineering
  contract; use before migration handoff or periodic health checks.
- `ui-designer`: implementation workflow with explicit `PARITY`, `IMPROVE`, and
  `NEW` modes.
- `verification-gate`: fresh claim-to-evidence validation before completion.

## GSD usage

GSD is the project lifecycle framework, not a replacement for domain skills. It
maintains planning state, supports long-running/multi-phase work, dispatches
specialized agents, and provides discuss/plan/execute/verify/ship loops.

GSD is opt-in. Replit Agent does not consume Claude Code's GSD runtime, so a
generated Replit project must not initialize GSD automatically or spend agent
credits on it. Install it only when the project will be developed with Claude
Code and the work benefits from a persistent multi-phase workflow.

Check and install explicitly:

```bash
test -f .claude/gsd-core/VERSION \
  || npx -y @opengsd/gsd-core@latest --claude --local
```

After installation, verify that the project's `CLAUDE.md`, `.claude/rules/`,
`.claude/agent_docs/`, and custom `.claude/skills/` still exist. GSD must
coexist with the engineering contract, not replace it.

Use `/gsd-help` for the complete installed command list. The common path is:

```text
/gsd-new-project or /gsd-new-milestone
/gsd-discuss-phase
/gsd-plan-phase
/gsd-execute-phase
/gsd-verify-work
/gsd-ship
```

Within GSD, use specialized skills as focused gates when their domain applies.
GSD remains responsible for lifecycle/state; the skill remains responsible for
domain depth. Outside GSD, always finish implementation work with
`verification-gate`.
