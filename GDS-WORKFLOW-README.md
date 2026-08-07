# GSD Workflow for this repo

This repository ships with **[GSD Core](https://github.com/open-gsd/gsd-core)** — a
spec-driven development framework for AI coding agents (Claude Code, Cursor, Gemini, …).
The framework lives in [`.claude/`](.claude/) and is **committed to the repo**, so the
whole team shares the exact same rules, commands, agents, and hooks.

> **Two kinds of commands below**
> - **Terminal commands** (` ```bash ` blocks) — run in your shell.
> - **`/gsd-*` commands** — run *inside a Claude Code session*, not the terminal.

---

## 1. One-time setup (per developer)

The GSD framework files are already in the repo. You only need:

1. **Node.js 18+** and **Claude Code** installed.
   ```bash
   node -v          # expect v18 or newer
   ```
2. Your **personal** Claude Code settings (permissions). The shared hooks live in
   `.claude/settings.json` (committed); your personal allow/deny rules go in
   `.claude/settings.local.json`, which is **git-ignored**. Re-running the installer
   regenerates it for your machine:
   ```bash
   npx @opengsd/gsd-core@latest --claude --local
   ```
   This is **idempotent** — it refreshes the framework and writes your local settings
   without clobbering the committed shared files.
3. Open the repo in Claude Code and reload so it picks up `.claude/commands`,
   `.claude/agents`, and `.claude/settings.json`.

Verify the install:
```bash
cat .claude/gsd-core/VERSION        # e.g. 1.5.0
ls .claude/commands/gsd | wc -l     # ~69 commands
```

## Engineering rules integration

GSD and the shared engineering contract coexist in the same `.claude/` tree:

- GSD owns `agents/`, `commands/`, `gsd-core/`, hooks, and its profile/install
  metadata.
- The shared engineering contract owns `agent_docs/`, `rules/`, the custom
  review/workflow entries under `skills/`, and the repository-root `CLAUDE.md`.
- GSD planners, executors, reviewers, and fixers already load `CLAUDE.md` and
  project skills. They must treat those rules as hard constraints.
- Do not remove or replace GSD when updating the engineering rules. Do not copy
  project names, package roots, ports, or machine-specific paths into the shared
  contract; discover them from each consuming project.

After a GSD upgrade, verify that both surfaces still exist:

```bash
test -f .claude/gsd-core/VERSION
test -f CLAUDE.md
test -f .claude/rules/00-backend-hard-rules.md
test -f .claude/skills/task-workflow/SKILL.md
```

---

## 2. The GSD phase loop

GSD drives work through a repeating five-step loop. Run these **inside Claude Code**:

| Step | Command | What it does |
| --- | --- | --- |
| 1. Discuss | `/gsd-discuss-phase` | Capture decisions before any code is written |
| 2. Plan | `/gsd-plan-phase` | Research & decompose the work into a `PLAN.md` |
| 3. Execute | `/gsd-execute-phase` | Build the plan in parallel waves with clean contexts |
| 4. Verify | `/gsd-verify-work` | Validate the result; generate fix plans if needed |
| 5. Ship | `/gsd-ship` | Open a PR and archive the completed phase |

Helpful anytime:
- `/gsd-help` — list every command
- `/gsd-progress` — where am I, what's next
- `/gsd-stats` — project statistics

---

## 3. Step-by-step: a new project

Run inside Claude Code, in order:

```text
/gsd-new-project        # gather context, write PROJECT.md + ROADMAP.md
/gsd-discuss-phase      # decide the approach for phase 1
/gsd-plan-phase         # produce PLAN.md for phase 1
/gsd-execute-phase      # implement phase 1
/gsd-verify-work        # confirm it does what was promised
/gsd-ship               # PR + archive, then loop to the next phase
```

State persists between sessions in `.planning/` (e.g. `STATE.md`, `CONTEXT.md`,
`ROADMAP.md`), so you can stop and resume with `/gsd-resume-work`.

## 4. Step-by-step: adding to an existing codebase

```text
/gsd-map-codebase       # analyze the repo into .planning/codebase/
/gsd-new-milestone      # define the next chunk of work
/gsd-plan-phase         # plan the first phase of that milestone
/gsd-execute-phase
/gsd-verify-work
/gsd-ship
```

---

## 5. Maintenance (terminal)

```bash
# Update GSD to the latest version (keeps your committed files in sync)
npx @opengsd/gsd-core@latest --claude --local

# See what the installer would change, without writing anything
npx @opengsd/gsd-core@latest --claude --local --dry-run

# Remove GSD entirely
npx @opengsd/gsd-core@latest --claude --local --uninstall
```

You can also run `/gsd-update` inside Claude Code.

---

## What's committed vs. local

| Path | Committed? | Why |
| --- | --- | --- |
| `.claude/commands/`, `.claude/agents/`, `.claude/hooks/`, `.claude/gsd-core/` | ✅ | Shared GSD workflow runtime |
| `.claude/agent_docs/`, `.claude/rules/`, `.claude/skills/`, `CLAUDE.md` | ✅ | Shared engineering contract and compliance gates |
| `.claude/settings.json` | ✅ | Shared hook wiring (uses `node` on `PATH`, no machine paths) |
| `.claude/settings.local.json` | ❌ ignored | Your personal permissions + machine-specific paths |
| `.claude/gsd-install-state.json` | ❌ ignored | Per-machine install metadata |
| `.planning/` | project-dependent | Per-project workflow state |

---

## More

- Framework source & docs: https://github.com/open-gsd/gsd-core
- Run `/gsd-help` for the full command reference.
