# Phase Ledger

Handoff record for agent work in this repository, as required by LuxForge [AI Agent Governance](https://github.com/LuxForge-ltd/pillars/blob/main/standards/ai-agent-governance.md#phase-ledger). Read this before starting work; update it as part of each approved commit.

- Repository: `LuxForge-ltd/LuxDBDiagram`, a fork of `chartdb/chartdb` taken at ChartDB release 1.21.0 (`ee95448`).
- Integration branch: `Dev`, created by the agent on 2026-11-24 from `main` at `ee95448`, with the operator's authorisation.
- Current version: see `VERSION`. LuxDBDiagram started at 0.0.1 in Phase 01; `package.json` keeps ChartDB's own version.
- Design: [docs/luxdbdiagram/architecture.md](docs/luxdbdiagram/architecture.md).

## Approved Plans

- 2026-11-24, Ben, Claude Code desktop app on joyeuse (brief "LuxDBDiagram — Implementation Brief v0.1.0"): inspect ChartDB, produce an implementation plan, then implement Areas, Dupes, Floats and enhanced DBML in phases.
- 2026-11-24, Ben, same session (decision cards): the agent creates `Dev` from `main` at `ee95448`; the agent disables GitHub Actions on the repository with `gh api` (done: Actions permission `enabled=false`); the GAP schema is not copied into this public repository, and GAP tests read it from a local folder named by `LUXDB_GAP_SCHEMA_DIR`; ChartDB's rectangle areas are relabelled **Groups** in the UI only.
- 2026-11-24, Ben, same session ("Approve, run all"): the six-phase plan is approved as a sequence. The agent carries out Phases 01 to 06 in order and, once each phase's checks pass on joyeuse, commits, pushes, opens the pull request to `Dev` and merges it. This authorises merging those six pull requests. The agent stops for any decision it cannot reasonably make.

## Phases

| Phase | Branch | Status | Version | Pull request | Commit approval |
| --- | --- | --- | --- | --- | --- |
| 01 Repository governance baseline | `phase-01-repository-governance-baseline` | Merged into `Dev` (`34564d2`) | 0.0.1 | [#1](https://github.com/LuxForge-ltd/LuxDBDiagram/pull/1) | "Approve, run all", 2026-11-24 |
| 02 Areas and enhanced DBML | `phase-02-areas-enhanced-dbml` | Merged into `Dev` (`1bb13e5`) | 0.0.2 | [#2](https://github.com/LuxForge-ltd/LuxDBDiagram/pull/2) | "Approve, run all", 2026-11-24 |
| 03 Visual membership management | `phase-03-visual-membership-management` | Complete, checks passed on joyeuse | 0.0.3 | this pull request | "Approve, run all", 2026-11-24 |
| 04 Dupes and instance navigation | `phase-04-dupes-instance-navigation` | Planned | 0.0.4 | | "Approve, run all", 2026-11-24 |
| 05 Float relationship cards | `phase-05-float-relationship-cards` | Planned | 0.0.5 | | "Approve, run all", 2026-11-24 |
| 06 Persistence, export and validation | `phase-06-persistence-export-validation` | Planned | 0.0.6 | | "Approve, run all", 2026-11-24 |

## Handoff Notes

- Checks before each pull request: `npm run lint`, `npx vitest run`, `npm run build`, run on joyeuse.
- Baseline before any change (ChartDB 1.21.0 on joyeuse, 2026-11-24): build passed; 842 tests in 109 files passed.
- GitHub Actions is disabled for the repository and ChartDB's workflow files are removed in Phase 01. Do not re-enable them.
- The `upstream` remote points at `chartdb/chartdb` for pulling in future ChartDB changes.
- Version 0.1.0 is set only when the operator says so.
- Pull requests must name the repository explicitly (`gh pr create --repo LuxForge-ltd/LuxDBDiagram`): as a fork, `gh` otherwise targets `chartdb/chartdb`.
- GAP checks: `LUXDB_GAP_SCHEMA_DIR="L:/LuxForge/Grassroots Admin Portal/docs/architecture/schema" npx vitest run src/lib/areas`. On 2026-11-24 the GAP domain files had two broken references, reported to the operator: `finances.dbml` line 78 refers to `match_team_players` (the table is `match_team_player`), and `roles_groups.dbml` line 23 refers to `resource_groups`, which only `gap_combined.dbml` defines.
- Phase 02 notes: Areas are stored in Dexie version 14 (`area_views`). In the code the concept is `AreaView`; ChartDB's own `Area` (canvas rectangles) is labelled "Groups" in the English UI only.
