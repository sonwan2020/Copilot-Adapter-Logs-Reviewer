# Squad Team

> Copilot-Log-Reviewer

## Coordinator

| Name | Role | Notes |
|------|------|-------|
| Squad | Coordinator | Routes work, enforces handoffs and reviewer gates. |

## Members

| Name | Role | Charter | Status |
|------|------|---------|--------|
| Deckard | Lead | .squad/agents/deckard/charter.md | 🏗️ Lead |
| Batty | Core Dev (Planner) | .squad/agents/batty/charter.md | 🔧 Implementation Planner |
| Pris | Tester | .squad/agents/pris/charter.md | 🧪 Tester |
| Scribe | Scribe | .squad/agents/scribe/charter.md | 📋 Scribe |
| Ralph | Work Monitor | — | 🔄 Monitor |
| @copilot | 🤖 Coding Agent | — | 🤖 Active |

### @copilot Capability Profile

**🟢 Good fit:** bug fix, test coverage, lint, format, dependency update, small feature, scaffolding, doc fix, documentation

**🟡 Needs review:** medium feature, refactoring, api endpoint, migration

**🔴 Not suitable:** architecture, system design, security, auth, encryption, performance

<!-- copilot-auto-assign: true -->

### Agent Pipeline

```
Issue → Deckard (triage & analysis) → Batty (implementation plan) → @copilot (coding) → PR → Deckard (code review) → Pris (QA) → Merge
```

- **Deckard** is always the first entry point. He analyzes the problem, asks for clarifications if needed, and creates the architectural plan.
- **Batty** translates Deckard's plan into a detailed step-by-step implementation spec that @copilot can execute.
- **@copilot** implements the code per Batty's spec and opens a PR.
- **Deckard** reviews the PR for architecture and quality.
- **Pris** validates the PR with structured QA testing.
- Bug fixes loop back through **Batty** (fix plan) → **@copilot** (code fix).

## Project Context

- **Owner:** Songbo Wang
- **Project:** Copilot-Log-Reviewer — zero-dependency, client-side web app for visualizing Copilot Adapter log files (JSONL)
- **Stack:** Vanilla JS (ES modules), HTML, CSS. No bundler, no server.
- **Created:** 2026-04-23
