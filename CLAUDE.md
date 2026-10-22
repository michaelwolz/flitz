# flitz

Self-hostable, AI-first link shortener with device/country redirect rules and privacy-preserving click analytics. One instance serves one team. License: Apache-2.0.

@AGENTS.md

## Working style

Keep code and tests simple (ponytail): smallest complete change, few tests through the HTTP seam (in-process app + Testcontainers Postgres/Redis), happy path plus the edge cases that actually bite. No mocks of our own code, no tests of internals.

## Agent skills

### Issue tracker

Issues and PRDs live as markdown files under `.scratch/<feature-slug>/` in this repo. `.scratch/` is gitignored: issues stay local and are never committed. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the default label vocabulary (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` at the repo root. See `docs/agents/domain.md`.
