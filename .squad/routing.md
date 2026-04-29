# Work Routing

How to decide who handles what.

## Routing Table

| Work Type | Route To | Examples |
|-----------|----------|----------|
| Architecture & design | Deckard | Data flow changes, CSP compliance, memory optimization strategy |
| Code review | Deckard | Review PRs, check quality, approve/reject changes |
| Implementation planning | Batty | Translate Deckard's analysis into step-by-step specs for @copilot |
| Fix planning (review feedback) | Batty | Create fix plan from Deckard's review comments for @copilot |
| Fix planning (test failures) | Batty | Create bug fix plan from Pris's test report for @copilot |
| Code implementation | @copilot | JS, CSS, HTML — features, refactors, bug fixes (via Batty's spec) |
| Testing & QA | Pris | Edge cases, validation, memory profiling, regression checks |
| Scope & priorities | Deckard | What to build next, trade-offs, decisions |
| Session logging | Scribe | Automatic — never needs routing |

## Issue Routing

| Label | Action | Who |
|-------|--------|-----|
| `squad` | Triage: analyze issue, ask clarifications, create plan | Lead (Deckard) |
| `squad:needs-info` | Blocked: waiting for clarification on requirements | Lead (Deckard) |
| `squad:batty` | Create implementation spec for @copilot | Core Dev (Batty) |
| `squad:copilot` | Implement code per Batty's spec | @copilot |
| `squad:{name}` | Pick up issue and complete the work | Named member |

### How the Agent Pipeline Works

1. When a GitHub issue gets the `squad` label, **Deckard** (Lead) triages it — analyzing the problem, asking for clarification if requirements are unclear, and commenting with an architectural plan.
2. When Deckard is satisfied the plan is clear, he assigns `squad:batty`. **Batty** reads the plan and creates a detailed step-by-step implementation spec as a comment.
3. Batty assigns `squad:copilot`. **@copilot** picks up the implementation spec and opens a PR.
4. The PR goes to **Deckard** for code review, then **Pris** for QA testing.
5. If bugs are found, **Batty** creates a fix plan and reassigns to **@copilot**.
6. The cycle repeats until the PR passes review and QA.

## Rules

1. **Pipeline order** — respect the chain: Deckard → Batty → @copilot → Deckard (review) → Pris (QA). Don't skip stages.
2. **Eager by default** — spawn all agents who could usefully start work, including anticipatory downstream work.
3. **Scribe always runs** after substantial work, always as `mode: "background"`. Never blocks.
4. **Quick facts → coordinator answers directly.** Don't spawn an agent for "what port does the server run on?"
5. **When two agents could handle it**, pick the one whose domain is the primary concern.
6. **"Team, ..." → fan-out.** Spawn all relevant agents in parallel as `mode: "background"`.
7. **Anticipate downstream work.** If a plan is being created, spawn Pris to write test scenarios from requirements simultaneously.
8. **Issue-labeled work** — follow label routing: `squad` → Deckard, `squad:batty` → Batty, `squad:copilot` → @copilot.
9. **Bug fix loops** — always go through Batty (fix plan) → @copilot (code), never assign @copilot directly.
